"""Sit in front of the Hub handler.py and stream the mp4 to a presigned R2 URL.

Also patches SeedVR2 prompts so a 24 GB 4090 does not encode 8K. The Hub always
sets resolution = min(w,h)*2; a 4K clip becomes 4320 and OOMs in Phase 1.
4K sources stay 4K and are split into short overlapping windows so SeedVR2
never loads the whole clip as one IMAGE tensor.

Deploy this file as /handler.py after copying the original Hub handler to
/hub_handler.py. The worker never receives R2_SECRET_ACCESS_KEY.
"""

from __future__ import annotations

import copy
import gc
import json
import os
import runpy
import shutil
import sys
import time
from contextvars import ContextVar
from typing import Any

sys.path.insert(0, "/")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or "/")

import runpod.serverless as serverless

from progress import comfy_progress_percent, hold_progress
from r2_put import (
    PreparedRifeSource,
    _find_video_path,
    _newest_mp4,
    prepare_rife_source,
    stitch_rife_chunk_outputs,
    upload_master,
)
from vram import (
    apply_cuda_alloc,
    cap_resolution,
    patch_seedvr2_prompt,
    should_skip_upscale,
)

apply_cuda_alloc()

_real_start = serverless.start
HUB_HANDLER = os.environ.get("LUMEN_HUB_HANDLER", "/hub_handler.py")
_job_input: ContextVar[dict[str, Any]] = ContextVar("lumen_job_input", default={})
_current_job: ContextVar[Any] = ContextVar("lumen_job", default=None)
_progress_high: ContextVar[int] = ContextVar("lumen_progress_high", default=0)


def _current_input() -> dict[str, Any]:
    value = _job_input.get()
    return value if isinstance(value, dict) else {}


def _progress(percent: int, stage: str, detail: str = "") -> None:
    job = _current_job.get()
    if not job:
        return
    held = hold_progress(_progress_high.get(), percent)
    _progress_high.set(held)
    payload = {
        "percent": held,
        "stage": stage,
        "detail": detail,
    }
    try:
        serverless.progress_update(job, json.dumps(payload))
    except Exception as exc:
        print(f"Lumen wrap: progress_update failed: {exc}", flush=True)


def _progress_from_comfy_message(message: dict[str, Any]) -> None:
    kind = message.get("type")
    data = message.get("data") if isinstance(message.get("data"), dict) else {}
    if kind == "progress":
        value = data.get("value")
        maximum = data.get("max") or data.get("maximum") or 0
        try:
            percent = comfy_progress_percent(float(value), float(maximum))
        except (TypeError, ValueError):
            return
        _progress(percent, "Enhancing on GPU", f"{int(float(value))}/{int(float(maximum))} samples")


def _wrap_queue_prompt(original):
    def queue_prompt(prompt):
        job_input = _current_input()
        if should_skip_upscale(job_input):
            print("Lumen wrap: skipping SeedVR2 (fps-only interpolation)", flush=True)
        patched = patch_seedvr2_prompt(prompt if isinstance(prompt, dict) else {}, job_input)
        return original(patched)

    return queue_prompt


def _wrap_calculate_resolution(_original):
    def calculate_resolution(width, height):
        return cap_resolution(width, height, _current_input())

    return calculate_resolution


def _gif_path_from_history(entry: dict[str, Any]) -> str | None:
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        return None
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        gifs = node_output.get("gifs")
        if not isinstance(gifs, list):
            continue
        for video in gifs:
            if isinstance(video, dict) and isinstance(video.get("fullpath"), str):
                return video["fullpath"]
    return None


def _history_error(entry: dict[str, Any]) -> str | None:
    status = entry.get("status")
    if isinstance(status, dict) and status.get("status_str") == "error":
        messages = status.get("messages")
        return str(messages) if messages else "ComfyUI execution error"
    return None


def _wrap_get_video_path(original):
    def get_video_path(ws, prompt):
        main = sys.modules.get("__main__")
        if main is None or not hasattr(main, "queue_prompt") or not hasattr(main, "get_history"):
            return original(ws, prompt)

        queued = main.queue_prompt(prompt)
        prompt_id = queued["prompt_id"]
        deadline = time.time() + 3600
        socket = ws
        _progress(28, "Enhancing on GPU", "ComfyUI graph is running")
        while time.time() < deadline:
            if socket is not None:
                try:
                    socket.settimeout(5.0)
                    out = socket.recv()
                    if isinstance(out, str):
                        message = json.loads(out)
                        if message.get("type") == "execution_error":
                            data = message.get("data") if isinstance(message.get("data"), dict) else {}
                            raise RuntimeError(
                                str(data.get("exception_message") or data.get("exception_type") or "ComfyUI execution error"),
                            )
                        _progress_from_comfy_message(message)
                        if message.get("type") == "executing":
                            data = message.get("data") if isinstance(message.get("data"), dict) else {}
                            if data.get("node") is None and data.get("prompt_id") == prompt_id:
                                break
                except RuntimeError:
                    raise
                except Exception:
                    print("Lumen wrap: ComfyUI websocket dropped; waiting on HTTP history", flush=True)
                    socket = None
            try:
                history = main.get_history(prompt_id)
                entry = history.get(prompt_id) if isinstance(history, dict) else None
                if isinstance(entry, dict):
                    err = _history_error(entry)
                    if err:
                        raise RuntimeError(err)
                    path = _gif_path_from_history(entry)
                    if path:
                        return path
            except RuntimeError:
                raise
            except Exception:
                pass
            time.sleep(1)

        history = main.get_history(prompt_id)
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(entry, dict):
            path = _gif_path_from_history(entry)
            if path:
                return path
        raise RuntimeError("ComfyUI finished without a video file.")

    return get_video_path


def _install_hub_patches() -> None:
    main = sys.modules.get("__main__")
    if main is None:
        return
    if hasattr(main, "queue_prompt") and not getattr(main, "_lumen_vram_patched", False):
        main.queue_prompt = _wrap_queue_prompt(main.queue_prompt)
        main._lumen_vram_patched = True
    if hasattr(main, "calculate_resolution") and not getattr(main, "_lumen_res_patched", False):
        main.calculate_resolution = _wrap_calculate_resolution(main.calculate_resolution)
        main._lumen_res_patched = True
    if hasattr(main, "get_video_path") and not getattr(main, "_lumen_wait_patched", False):
        main.get_video_path = _wrap_get_video_path(main.get_video_path)
        main._lumen_wait_patched = True


def _copy_chunk_output(output: Any, dest: str) -> str:
    path = _find_video_path(output)
    if path is None:
        path = _newest_mp4()
    if path is None or not os.path.isfile(path):
        raise RuntimeError("RIFE chunk produced no video file.")
    if os.path.abspath(path) != os.path.abspath(dest):
        shutil.copy2(path, dest)
    return dest


def _release_chunk_ram() -> None:
    gc.collect()
    try:
        import torch

        torch.cuda.empty_cache()
    except Exception:
        pass


def _run_rife_chunks(inner, job: Any, prepared: PreparedRifeSource) -> dict[str, Any]:
    outputs: list[str] = []
    total = max(1, len(prepared.chunk_paths))
    for index, chunk_path in enumerate(prepared.chunk_paths):
        _progress(
            24 + int(62 * index / total),
            "Enhancing on GPU",
            f"GPU chunk {index + 1}/{total}",
        )
        chunk_job = copy.deepcopy(job) if isinstance(job, dict) else {"input": {}}
        chunk_input = dict(prepared.work_input)
        chunk_input["video_path"] = chunk_path
        chunk_input.pop("video_url", None)
        chunk_input.pop("video_base64", None)
        chunk_job["input"] = chunk_input
        result = inner(chunk_job)
        if isinstance(result, dict) and result.get("error"):
            return result
        dest = os.path.join(prepared.work_dir, f"out_{index:03d}.mp4")
        outputs.append(_copy_chunk_output(result, dest))
        _release_chunk_ram()
    stitched = stitch_rife_chunk_outputs(outputs, prepared)
    return {"video_path": stitched}


def _patched_start(config):
    _install_hub_patches()
    inner = config["handler"]

    def handler(job):
        payload = job.get("input") if isinstance(job, dict) else {}
        working = payload if isinstance(payload, dict) else {}
        job_token = _current_job.set(job)
        high_token = _progress_high.set(0)
        prepared = None
        input_token = None
        try:
            _progress(22, "Starting on GPU", "Worker picked up the job")
            prepared = prepare_rife_source(working)
            work_input = prepared.work_input if prepared is not None else working
            input_token = _job_input.set(work_input)
            if prepared is not None:
                output = _run_rife_chunks(inner, job, prepared)
            else:
                output = inner(job)
            if isinstance(output, dict) and output.get("error"):
                return output
            _progress(88, "Uploading master", "Streaming the mp4 to private R2")
            uploaded = upload_master(work_input, output)
            _progress(96, "Uploading master", "Master landed in R2")
            return uploaded
        finally:
            if prepared is not None:
                shutil.rmtree(prepared.work_dir, ignore_errors=True)
            _current_job.reset(job_token)
            _progress_high.reset(high_token)
            if input_token is not None:
                _job_input.reset(input_token)

    _real_start({**config, "handler": handler})


serverless.start = _patched_start


def main() -> None:
    path = HUB_HANDLER
    if not os.path.isfile(path):
        for candidate in ("/handler.orig.py", "/workspace/handler.py", "/ComfyUI/handler.py"):
            if os.path.isfile(candidate):
                path = candidate
                break
    if not os.path.isfile(path):
        raise SystemExit("Could not find the Hub handler.py to wrap.")
    sys.path.insert(0, os.path.dirname(os.path.abspath(path)) or "/")
    runpy.run_path(path, run_name="__main__")


if __name__ == "__main__":
    main()
