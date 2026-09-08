"""Stream a finished mp4 to a presigned R2 URL. The worker never sees R2 secrets."""

from __future__ import annotations

import glob
import http.client
import json
import os
import subprocess
import tempfile
from typing import Any
from urllib.parse import urlparse
import base64

PUT_LIMIT = 5 * 1024 * 1024 * 1024 - 16 * 1024 * 1024
INLINE_LIMIT = 12 * 1024 * 1024
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
        return attach_local_output(output, job_input)

    path = _find_video_path(output)
    if path is None:
        path = _decode_inline_video(output)
    if path is None:
        path = _newest_mp4()
    if path is None or not os.path.isfile(path):
        raise RuntimeError("GPU finished but no mp4 was found to upload.")

    path = conform_output(path, job_input)
    size = os.path.getsize(path)
    probe = probe_video(path)
    content_type = str(job_input.get("content_type") or "video/mp4")
    multipart = job_input.get("multipart") if isinstance(job_input.get("multipart"), dict) else {}

    if size <= PUT_LIMIT or not multipart.get("partUrls"):
        etag = stream_put(upload_url, path, content_type)
        result: dict[str, Any] = {"object_key": object_key, "byte_size": size, "etag": etag}
        if probe:
            result["probe"] = probe
        return result

    parts = stream_multipart(path, multipart)
    result = {
        "object_key": object_key,
        "byte_size": size,
        "etag": None,
        "upload_id": multipart.get("uploadId"),
        "parts": parts,
    }
    if probe:
        result["probe"] = probe
    return result


def probe_video(path: str) -> dict[str, Any]:
    try:
        raw = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,tags",
                "-show_entries",
                "stream_side_data",
                "-show_entries",
                "format=duration,size:format_tags",
                "-of",
                "json",
                path,
            ],
            text=True,
            timeout=30,
        )
        data = json.loads(raw)
        stream = (data.get("streams") or [{}])[0]
        fmt = data.get("format") or {}
        rate = None
        if isinstance(stream, dict):
            rate = stream.get("r_frame_rate") or stream.get("avg_frame_rate")
        fps = _fps_from_rate(rate if isinstance(rate, str) else None)
        info: dict[str, Any] = {
            "width": stream.get("width") if isinstance(stream, dict) else None,
            "height": stream.get("height") if isinstance(stream, dict) else None,
            "fps": fps,
            "frame_rate": rate,
            "frames": stream.get("nb_frames") if isinstance(stream, dict) else None,
            "duration": fmt.get("duration") if isinstance(fmt, dict) else None,
            "size": fmt.get("size") if isinstance(fmt, dict) else None,
        }
        cleaned = {key: value for key, value in info.items() if value not in (None, "")}
        print(f"Lumen wrap: output probe {cleaned}", flush=True)
        return cleaned
    except Exception as error:
        print(f"Lumen wrap: ffprobe failed: {error}", flush=True)
        return {}


def attach_local_output(output: Any, job_input: dict[str, Any] | None = None) -> dict[str, Any]:
    """Hub often returns only a worker-local path. Inline small files so we can inspect fps."""
    result = dict(output) if isinstance(output, dict) else {"output": output}
    path = _find_video_path(result)
    if path is None:
        path = _newest_mp4()
    if path is None or not os.path.isfile(path):
        return result
    if job_input:
        path = conform_output(path, job_input)
        result["video_path"] = path
    probe = probe_video(path)
    if probe:
        result["probe"] = probe
    size = os.path.getsize(path)
    if size <= INLINE_LIMIT and not _has_inline_video(result):
        with open(path, "rb") as handle:
            result["video_base64"] = base64.b64encode(handle.read()).decode("ascii")
        result.setdefault("video_path", path)
        print(f"Lumen wrap: attached inline video ({size} bytes)", flush=True)
    return result


def job_target_fps(job_input: dict[str, Any] | None) -> float | None:
    if not job_input:
        return None
    for key in ("fps", "target_fps"):
        raw = job_input.get(key)
        if isinstance(raw, bool) or raw is None:
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            continue
        if number > 0:
            return number
    return None


def fps_filter_value(fps: float) -> str:
    if abs(fps - 23.976) < 0.02:
        return "24000/1001"
    if abs(fps - 29.97) < 0.02:
        return "30000/1001"
    if abs(fps - 59.94) < 0.02:
        return "60000/1001"
    rounded = round(fps)
    if abs(fps - rounded) < 0.02:
        return str(int(rounded))
    return f"{fps:.3f}".rstrip("0").rstrip(".")


def normalize_rotation(value: Any) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    try:
        degrees = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return degrees % 360


def transpose_filter(rotation: int) -> str | None:
    turns = normalize_rotation(rotation)
    if turns == 90:
        return "transpose=1"
    if turns == 180:
        return "hflip,vflip"
    if turns == 270:
        return "transpose=2"
    return None


def output_needs_rotation(width: Any, height: Any, rotation: int) -> bool:
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        return False
    if width <= 0 or height <= 0:
        return False
    turns = normalize_rotation(rotation)
    if turns == 180:
        return True
    if turns not in (90, 270):
        return False
    # Phone clips are coded landscape and displayed portrait. If the GPU left
    # the coded orientation, the master is still wider than it is tall.
    return width >= height


def output_needs_fps(current: Any, target: float | None) -> bool:
    if target is None or not isinstance(current, (int, float)):
        return False
    return float(current) > target + 0.15


def conform_output(path: str, job_input: dict[str, Any] | None) -> str:
    """One ffmpeg pass: drop RIFE's extra frames (120→60) and bake 9:16 rotation."""
    if not job_input:
        return path
    target = job_target_fps(job_input)
    rotation = normalize_rotation(job_input.get("rotation"))
    probe = probe_video(path)
    filters: list[str] = []
    notes: list[str] = []
    need_fps = output_needs_fps(probe.get("fps"), target) and target is not None
    vf_rot = transpose_filter(rotation)
    need_rot = bool(vf_rot and output_needs_rotation(probe.get("width"), probe.get("height"), rotation))
    if need_fps and target is not None:
        filters.append(f"fps={fps_filter_value(target)}")
        notes.append(f"{float(probe.get('fps') or 0):g}→{target:g} fps")
    if need_rot and vf_rot:
        filters.append(vf_rot)
        notes.append(f"rotate {rotation} deg")
    if not filters:
        return path
    dest = _conformed_path(path, target if need_fps else None, rotation if need_rot else 0)
    _ffmpeg_filters(path, dest, ",".join(filters))
    print(f"Lumen wrap: conformed output ({', '.join(notes)})", flush=True)
    return dest


def conform_output_rotation(path: str, job_input: dict[str, Any] | None) -> str:
    """Bake display rotation so a 9:16 source is not left as coded 16:9."""
    return conform_output(path, job_input)


def conform_output_fps(path: str, job_input: dict[str, Any] | None) -> str:
    """Decimate a denser RIFE encode (e.g. 120 fps) down to the requested rate (60)."""
    return conform_output(path, job_input)


def _conformed_path(path: str, fps: float | None, rotation: int) -> str:
    directory, name = os.path.split(path)
    stem, ext = os.path.splitext(name)
    bits: list[str] = []
    if fps is not None:
        bits.append(f"{fps_filter_value(fps).replace('/', '-')}fps")
    if rotation:
        bits.append(f"rot{rotation}")
    suffix = "-".join(bits) or "conform"
    return os.path.join(directory or tempfile.gettempdir(), f"{stem}-{suffix}{ext or '.mp4'}")


def _ffmpeg_filters(src: str, dest: str, vf: str) -> None:
    common = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-noautorotate",
        "-i",
        src,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        vf,
        "-metadata:s:v:0",
        "rotate=0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]
    try:
        subprocess.check_call(common + ["-c:a", "copy", dest], timeout=3600)
        return
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    subprocess.check_call(common + ["-c:a", "aac", "-b:a", "192k", dest], timeout=3600)


def _fps_from_rate(rate: str | None) -> float | None:
    if not rate:
        return None
    try:
        if "/" not in rate:
            number = float(rate)
            return number if number > 0 else None
        num, den = rate.split("/", 1)
        denom = float(den)
        if denom == 0:
            return None
        return float(num) / denom
    except ValueError:
        return None


def _has_inline_video(output: dict[str, Any]) -> bool:
    video = output.get("video") or output.get("video_base64") or output.get("data")
    return isinstance(video, str) and len(video) > 32


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
