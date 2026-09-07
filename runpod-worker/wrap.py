"""Sit in front of the Hub handler.py and stream the mp4 to a presigned R2 URL.

Deploy this file as /handler.py after copying the original Hub handler to
/hub_handler.py. The worker never receives R2_SECRET_ACCESS_KEY.
"""

from __future__ import annotations

import os
import runpy
import sys

sys.path.insert(0, "/")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or "/")

import runpod.serverless as serverless

from r2_put import upload_master

_real_start = serverless.start
HUB_HANDLER = os.environ.get("LUMEN_HUB_HANDLER", "/hub_handler.py")


def _patched_start(config):
    inner = config["handler"]

    def handler(job):
        payload = job.get("input") if isinstance(job, dict) else {}
        output = inner(job)
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
