"""Stream a finished mp4 to a presigned R2 URL. The worker never sees R2 secrets."""

from __future__ import annotations

import glob
import http.client
import os
import tempfile
from typing import Any
from urllib.parse import urlparse

PUT_LIMIT = 5 * 1024 * 1024 * 1024 - 16 * 1024 * 1024
SEARCH_DIRS = (
    "/ComfyUI/output",
    "/workspace/ComfyUI/output",
    "/runpod-volume",
    "/tmp",
)


def upload_master(job_input: dict[str, Any], output: Any) -> dict[str, Any]:
    object_key = job_input.get("object_key")
    upload_url = job_input.get("upload_url")
    if not isinstance(object_key, str) or not isinstance(upload_url, str):
        if isinstance(output, dict):
            return output
        return {"output": output}

    path = _find_video_path(output)
    if path is None:
        path = _decode_inline_video(output)
    if path is None:
        path = _newest_mp4()
    if path is None or not os.path.isfile(path):
        raise RuntimeError("GPU finished but no mp4 was found to upload.")

    size = os.path.getsize(path)
    content_type = str(job_input.get("content_type") or "video/mp4")
    multipart = job_input.get("multipart") if isinstance(job_input.get("multipart"), dict) else {}

    if size <= PUT_LIMIT or not multipart.get("partUrls"):
        etag = stream_put(upload_url, path, content_type)
        return {"object_key": object_key, "byte_size": size, "etag": etag}

    parts = stream_multipart(path, multipart)
    return {
        "object_key": object_key,
        "byte_size": size,
        "etag": None,
        "upload_id": multipart.get("uploadId"),
        "parts": parts,
    }


def stream_put(url: str, path: str, content_type: str) -> str | None:
    parsed = urlparse(url)
    size = os.path.getsize(path)
    conn = http.client.HTTPSConnection(parsed.hostname or "", parsed.port or 443, timeout=3600)
    target = parsed.path
    if parsed.query:
        target = f"{target}?{parsed.query}"
    headers = {
        "Content-Type": content_type,
        "Content-Length": str(size),
        "Host": parsed.netloc,
    }
    with open(path, "rb") as body:
        conn.request("PUT", target, body=body, headers=headers)
        response = conn.getresponse()
        payload = response.read()
        if response.status not in (200, 201):
            raise RuntimeError(f"R2 PUT failed ({response.status}): {payload[:400]!r}")
        etag = response.getheader("ETag")
        return etag.strip('"') if etag else None


def stream_multipart(path: str, multipart: dict[str, Any]) -> list[dict[str, Any]]:
    part_size = int(multipart.get("partSize") or 64 * 1024 * 1024)
    urls = multipart.get("partUrls") or []
    if not isinstance(urls, list) or not urls:
        raise RuntimeError("Multipart grant is missing part URLs.")
    parts: list[dict[str, Any]] = []
    with open(path, "rb") as handle:
        part_number = 1
        while True:
            chunk = handle.read(part_size)
            if not chunk:
                break
            if part_number > len(urls):
                raise RuntimeError("File is larger than the presigned multipart grant.")
            etag = _put_bytes(str(urls[part_number - 1]), chunk)
            parts.append({"partNumber": part_number, "etag": etag})
            part_number += 1
    return parts


def _put_bytes(url: str, payload: bytes) -> str:
    parsed = urlparse(url)
    conn = http.client.HTTPSConnection(parsed.hostname or "", parsed.port or 443, timeout=3600)
    target = parsed.path
    if parsed.query:
        target = f"{target}?{parsed.query}"
    conn.request(
        "PUT",
        target,
        body=payload,
        headers={"Content-Length": str(len(payload)), "Host": parsed.netloc},
    )
    response = conn.getresponse()
    body = response.read()
    if response.status not in (200, 201):
        raise RuntimeError(f"R2 part PUT failed ({response.status}): {body[:400]!r}")
    etag = response.getheader("ETag")
    if not etag:
        raise RuntimeError("R2 part PUT did not return an ETag.")
    return etag.strip('"')


def _find_video_path(output: Any) -> str | None:
    if not isinstance(output, dict):
        return None
    nested = output.get("output") if isinstance(output.get("output"), dict) else output
    for key in ("video_path", "path", "output_path"):
        value = nested.get(key)
        if isinstance(value, str) and os.path.isfile(value):
            return value
        if isinstance(value, str):
            for directory in SEARCH_DIRS:
                candidate = os.path.join(directory, os.path.basename(value))
                if os.path.isfile(candidate):
                    return candidate
    return None


def _decode_inline_video(output: Any) -> str | None:
    if not isinstance(output, dict):
        return None
    nested = output.get("output") if isinstance(output.get("output"), dict) else output
    video = nested.get("video") or nested.get("video_base64") or nested.get("data")
    if not isinstance(video, str) or len(video) < 32:
        return None
    payload = video.split("base64,", 1)[1] if "base64," in video else video
    import base64

    dest = os.path.join(tempfile.gettempdir(), "lumen-gpu-output.mp4")
    with open(dest, "wb") as handle:
        handle.write(base64.b64decode(payload))
    return dest


def _newest_mp4() -> str | None:
    found: list[str] = []
    for directory in SEARCH_DIRS:
        found.extend(glob.glob(os.path.join(directory, "**", "*.mp4"), recursive=True))
        found.extend(glob.glob(os.path.join(directory, "*.mp4")))
    if not found:
        return None
    return max(found, key=os.path.getmtime)
