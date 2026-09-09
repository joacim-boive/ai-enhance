"""Stream a finished mp4 to a presigned R2 URL. The worker never sees R2 secrets."""

from __future__ import annotations

import glob
import http.client
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from typing import Any, NamedTuple
from urllib.parse import urlparse
import base64

PUT_LIMIT = 5 * 1024 * 1024 * 1024 - 16 * 1024 * 1024
INLINE_LIMIT = 12 * 1024 * 1024
EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
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
    commands = (
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
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames",
            "-show_entries",
            "format=duration,size",
            "-of",
            "json",
            path,
        ],
    )
    last_error: Exception | None = None
    for command in commands:
        try:
            parsed = _parse_ffprobe(command)
        except Exception as error:
            last_error = error
            continue
        if parsed.get("width"):
            print(f"Lumen wrap: output probe {parsed}", flush=True)
            return parsed
        last_error = RuntimeError("ffprobe returned no video stream")
    print(f"Lumen wrap: ffprobe failed: {last_error}", flush=True)
    return {}


def _parse_ffprobe(command: list[str]) -> dict[str, Any]:
    proc = subprocess.run(command, capture_output=True, text=True, timeout=30)
    raw = (proc.stdout or "").strip()
    if not raw:
        err = (proc.stderr or "").strip() or f"ffprobe exit {proc.returncode}"
        raise RuntimeError(err)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        err = (proc.stderr or "").strip()
        raise RuntimeError(err or str(error)) from error
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
    return {key: value for key, value in info.items() if value not in (None, "")}


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
    return abs(float(current) - target) > 0.15


def fps_vf(current: float, target: float) -> list[str]:
    """ffmpeg graphs that land on target fps. Try motion interp when raising fps."""
    rate = fps_filter_value(target)
    if current > target + 0.15:
        return [f"fps={rate}"]
    return [
        f"minterpolate=fps={rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff",
        f"minterpolate=fps={rate}:mi_mode=blend",
        f"fps={rate}",
    ]


def conform_output(path: str, job_input: dict[str, Any] | None) -> str:
    """One ffmpeg pass: match target fps and bake 9:16 rotation."""
    if not job_input:
        return path
    target = job_target_fps(job_input)
    rotation = normalize_rotation(job_input.get("rotation"))
    probe = probe_video(path)
    current = probe.get("fps")
    need_fps = output_needs_fps(current, target) and target is not None
    vf_rot = transpose_filter(rotation)
    need_rot = bool(vf_rot and output_needs_rotation(probe.get("width"), probe.get("height"), rotation))
    if not need_fps and not need_rot:
        return path
    fps_candidates = (
        fps_vf(float(current), target) if need_fps and target is not None and isinstance(current, (int, float)) else [None]
    )
    dest = _conformed_path(path, target if need_fps else None, rotation if need_rot else 0)
    last_error: Exception | None = None
    for fps_filter in fps_candidates:
        filters: list[str] = []
        notes: list[str] = []
        if fps_filter:
            filters.append(fps_filter)
            notes.append(f"{float(current or 0):g}→{target:g} fps")
        if need_rot and vf_rot:
            filters.append(vf_rot)
            notes.append(f"rotate {rotation} deg")
        if not filters:
            return path
        try:
            _ffmpeg_filters(path, dest, ",".join(filters))
            print(f"Lumen wrap: conformed output ({', '.join(notes)})", flush=True)
            return dest
        except (subprocess.CalledProcessError, FileNotFoundError) as error:
            last_error = error
            continue
    if last_error:
        raise last_error
    return path


def conform_output_rotation(path: str, job_input: dict[str, Any] | None) -> str:
    """Bake display rotation so a 9:16 source is not left as coded 16:9."""
    return conform_output(path, job_input)


def conform_output_fps(path: str, job_input: dict[str, Any] | None) -> str:
    """Decimate a denser RIFE encode (e.g. 120 fps) down to the requested rate (60)."""
    return conform_output(path, job_input)


class PreparedRifeSource(NamedTuple):
    work_dir: str
    source_path: str
    chunk_paths: list[str]
    work_input: dict[str, Any]


def prepare_rife_source(job_input: dict[str, Any] | None) -> PreparedRifeSource | None:
    """Download the clip, bake display rotation, split overlapping RIFE chunks."""
    from vram import (
        gpu_chunk_source_frames,
        job_rife_plan,
        needs_rife_chunking,
        needs_seedvr2_chunking,
        rife_chunk_ranges,
        rife_chunk_source_frames,
        rife_working_dimensions,
        wants_gpu_preprocess,
    )

    if not job_input or not wants_gpu_preprocess(job_input):
        return None

    work_dir = tempfile.mkdtemp(prefix="lumen-rife-")
    try:
        source = _local_job_video(job_input, os.path.join(work_dir, "source.mp4"))
        rotation = normalize_rotation(job_input.get("rotation"))
        vf_rot = transpose_filter(rotation)
        if vf_rot:
            baked = os.path.join(work_dir, "source-upright.mp4")
            try:
                _encode_video_only(source, baked, vf_rot)
                print(f"Lumen wrap: baked source rotation {rotation} deg before RIFE", flush=True)
                source = baked
                rotation = 0
            except Exception as error:
                print(
                    f"Lumen wrap: rotation bake failed ({error}); using the coded orientation",
                    flush=True,
                )
                if os.path.isfile(baked):
                    os.unlink(baked)

        probe = probe_video(source)
        work_input = dict(job_input)
        work_input["rotation"] = rotation
        work_input.pop("video_url", None)
        work_input.pop("video_base64", None)
        if probe.get("width"):
            work_input["width"] = probe["width"]
        if probe.get("height"):
            work_input["height"] = probe["height"]
        if probe.get("fps"):
            work_input["source_fps"] = probe["fps"]
        if probe.get("duration"):
            try:
                work_input["duration"] = float(probe["duration"])
            except (TypeError, ValueError):
                pass

        frames = count_video_frames(source)
        plan = job_rife_plan(work_input)
        dims = rife_working_dimensions(work_input)
        tightest = gpu_chunk_source_frames(work_input)
        if tightest is not None:
            chunk_len = tightest
        elif plan is None:
            chunk_len = frames
        elif dims is None:
            chunk_len = 16
        else:
            chunk_len = rife_chunk_source_frames(dims[0], dims[1], plan.multiplier)
        ranges = rife_chunk_ranges(frames, chunk_len)
        if not ranges:
            ranges = [(0, max(frames, 1))]
        if not needs_rife_chunking(work_input, frames) and not needs_seedvr2_chunking(
            work_input, frames
        ):
            ranges = [(0, frames)]

        reason = "SeedVR2" if needs_seedvr2_chunking(work_input, frames) else "RIFE"
        print(
            f"Lumen wrap: {reason} source {frames} frames in {len(ranges)} chunk(s) "
            f"(~{chunk_len} source frames each)",
            flush=True,
        )
        chunk_paths: list[str] = []
        if len(ranges) == 1 and ranges[0] == (0, frames):
            chunk_paths.append(source)
        else:
            for index, (start, end) in enumerate(ranges):
                dest = os.path.join(work_dir, f"chunk_{index:03d}.mp4")
                extract_frame_range(source, dest, start, end)
                chunk_paths.append(dest)
        return PreparedRifeSource(work_dir, source, chunk_paths, work_input)
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise


def stitch_rife_chunk_outputs(
    paths: list[str],
    prepared: PreparedRifeSource,
) -> str:
    """Drop the overlap frame on chunks 2+, concat, restore original audio."""
    if not paths:
        raise RuntimeError("RIFE produced no chunk videos to stitch.")
    work_dir = prepared.work_dir
    trimmed: list[str] = []
    for index, path in enumerate(paths):
        if index == 0:
            trimmed.append(path)
            continue
        dest = os.path.join(work_dir, f"trim_{index:03d}.mp4")
        drop_leading_frames(path, dest, 1)
        trimmed.append(dest)
    concated = os.path.join(work_dir, "rife-concat.mp4")
    concat_video_files(trimmed, concated)
    muxed = os.path.join(work_dir, "rife-stitched.mp4")
    mux_original_audio(concated, prepared.source_path, muxed)
    return muxed


def count_video_frames(path: str) -> int:
    probe = probe_video(path)
    raw = probe.get("frames")
    if raw not in (None, "", "N/A"):
        try:
            counted = int(str(raw))
            if counted > 0:
                return counted
        except (TypeError, ValueError):
            pass
    fps = probe.get("fps")
    duration = probe.get("duration")
    if isinstance(fps, (int, float)) and duration not in (None, ""):
        try:
            counted = int(round(float(fps) * float(duration)))
            if counted > 0:
                return counted
        except (TypeError, ValueError):
            pass
    try:
        raw = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=nb_read_frames",
                "-of",
                "default=nokey=1:noprint_wrappers=1",
                path,
            ],
            text=True,
            timeout=120,
        )
        counted = int(str(raw).strip().splitlines()[0])
        if counted > 0:
            return counted
    except Exception:
        pass
    raise RuntimeError(f"Could not count frames in {path}")


def extract_frame_range(src: str, dest: str, start: int, end: int) -> None:
    if end <= start:
        raise ValueError(f"empty frame range [{start}, {end})")
    fps = probe_video(src).get("fps")
    _ffmpeg_select(
        src,
        dest,
        f"select='gte(n,{int(start)})*lt(n,{int(end)})',setpts=PTS-STARTPTS",
        fps if isinstance(fps, (int, float)) else None,
    )


def drop_leading_frames(src: str, dest: str, count: int = 1) -> None:
    skipped = max(1, int(count))
    fps = probe_video(src).get("fps")
    _ffmpeg_select(
        src,
        dest,
        f"select='gte(n,{skipped})',setpts=PTS-STARTPTS",
        fps if isinstance(fps, (int, float)) else None,
    )


def concat_video_files(paths: list[str], dest: str) -> None:
    if len(paths) == 1:
        shutil.copy2(paths[0], dest)
        return
    list_path = f"{dest}.txt"
    with open(list_path, "w", encoding="utf-8") as handle:
        for path in paths:
            escaped = path.replace("'", "'\\''")
            handle.write(f"file '{escaped}'\n")
    try:
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                "-c",
                "copy",
                dest,
            ],
            timeout=3600,
        )
        return
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    fps = probe_video(paths[0]).get("fps")
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_path,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-an",
    ]
    if isinstance(fps, (int, float)) and fps > 0:
        command.extend(["-r", fps_filter_value(float(fps))])
    command.append(dest)
    subprocess.check_call(command, timeout=3600)


def mux_original_audio(video_path: str, source_path: str, dest: str) -> None:
    duration = probe_video(video_path).get("duration")
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-i",
        source_path,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-movflags",
        "+faststart",
    ]
    if duration not in (None, ""):
        command.extend(["-t", str(duration)])
    try:
        subprocess.check_call(command + ["-c:a", "aac", "-b:a", "192k", dest], timeout=3600)
        return
    except subprocess.CalledProcessError:
        shutil.copy2(video_path, dest)


def _local_job_video(job_input: dict[str, Any], dest: str) -> str:
    path = job_input.get("video_path")
    if isinstance(path, str) and os.path.isfile(path):
        if os.path.abspath(path) != os.path.abspath(dest):
            shutil.copy2(path, dest)
            return dest
        return path
    url = job_input.get("video_url")
    if isinstance(url, str) and url:
        urllib.request.urlretrieve(url, dest)
        return dest
    payload = job_input.get("video_base64")
    if isinstance(payload, str) and len(payload) > 32:
        raw = payload.split("base64,", 1)[1] if "base64," in payload else payload
        with open(dest, "wb") as handle:
            handle.write(base64.b64decode(raw))
        return dest
    raise RuntimeError("Interpolation job has no video_url or video_path.")


def _ffmpeg_select(src: str, dest: str, vf: str, fps: float | None) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-noautorotate",
        "-i",
        src,
        "-vf",
        _with_even_frames(vf),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "12",
        "-pix_fmt",
        "yuv420p",
    ]
    if isinstance(fps, (int, float)) and fps > 0:
        command.extend(["-r", fps_filter_value(float(fps))])
    command.append(dest)
    subprocess.check_call(command, timeout=3600)


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


def _with_even_frames(vf: str) -> str:
    if EVEN_SCALE in vf:
        return vf
    return f"{vf},{EVEN_SCALE}" if vf else EVEN_SCALE


def _ffmpeg_filters(src: str, dest: str, vf: str) -> None:
    graph = _with_even_frames(vf)
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
        graph,
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
        if probe_video(dest).get("width"):
            return
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    if os.path.isfile(dest):
        os.unlink(dest)
    subprocess.check_call(common + ["-c:a", "aac", "-b:a", "192k", dest], timeout=3600)
    if not probe_video(dest).get("width"):
        raise RuntimeError(f"ffmpeg wrote an unreadable mp4: {dest}")


def _encode_video_only(src: str, dest: str, vf: str) -> None:
    """Working copy for RIFE/SeedVR2. Audio is muxed back from the original later."""
    if os.path.isfile(dest):
        os.unlink(dest)
    graph = _with_even_frames(vf)
    attempts = (["-movflags", "+faststart"], [])
    last_error: Exception | None = None
    for extra in attempts:
        command = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-noautorotate",
            "-i",
            src,
            "-an",
            "-vf",
            graph,
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
            *extra,
            dest,
        ]
        try:
            proc = subprocess.run(command, capture_output=True, text=True, timeout=3600)
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout or f"ffmpeg exit {proc.returncode}").strip()
                raise RuntimeError(err)
            if probe_video(dest).get("width"):
                return
            last_error = RuntimeError(f"unreadable output {dest}")
        except Exception as error:
            last_error = error
            print(f"Lumen wrap: ffmpeg encode failed: {error}", flush=True)
        if os.path.isfile(dest):
            os.unlink(dest)
    if last_error:
        raise last_error


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
