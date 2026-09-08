"""Sit in front of the Hub handler.py and stream the mp4 to a presigned R2 URL.

Also patches SeedVR2 prompts so a 24 GB 4090 does not encode 8K. The Hub always
sets resolution = min(w,h)*2; a 4K clip becomes 4320 and OOMs in Phase 1.

Deploy this file as /handler.py after copying the original Hub handler to
/hub_handler.py. The worker never receives R2_SECRET_ACCESS_KEY.
"""

from __future__ import annotations

import os
import runpy
import sys
from contextvars import ContextVar
from typing import Any

sys.path.insert(0, "/")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or "/")

import runpod.serverless as serverless

from r2_put import upload_master
from vram import apply_cuda_alloc, cap_resolution, patch_seedvr2_prompt

apply_cuda_alloc()

_real_start = serverless.start
HUB_HANDLER = os.environ.get("LUMEN_HUB_HANDLER", "/hub_handler.py")
_job_input: ContextVar[dict[str, Any]] = ContextVar("lumen_job_input", default={})


def _current_input() -> dict[str, Any]:
    value = _job_input.get()
    return value if isinstance(value, dict) else {}


def _wrap_queue_prompt(original):
    def queue_prompt(prompt):
        patched = patch_seedvr2_prompt(prompt if isinstance(prompt, dict) else {}, _current_input())
        return original(patched)

    return queue_prompt


def _wrap_calculate_resolution(_original):
    def calculate_resolution(width, height):
        return cap_resolution(width, height, _current_input())

    return calculate_resolution


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


def _patched_start(config):
    _install_hub_patches()
    inner = config["handler"]

    def handler(job):
        payload = job.get("input") if isinstance(job, dict) else {}
        token = _job_input.set(payload if isinstance(payload, dict) else {})
        try:
            output = inner(job)
        finally:
            _job_input.reset(token)
        if isinstance(output, dict) and output.get("error"):
            return output
        return upload_master(payload if isinstance(payload, dict) else {}, output)

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
