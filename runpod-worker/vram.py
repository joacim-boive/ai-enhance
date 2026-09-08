"""Keep SeedVR2 inside 24 GB by tiling, swapping DiT blocks, and capping short side.

The Hub handler always sets resolution = min(width, height) * 2 and encodes with
batch_size 33 / VAE tiles 1024. A 4K clip becomes 8K and dies in Phase 1 with
`Allocation on device`.
"""

from __future__ import annotations

import os
from typing import Any

MAX_SHORT_SIDE = 2160
UPSCALER_TYPE = "SeedVR2VideoUpscaler"
VAE_TYPE = "SeedVR2LoadVAEModel"
DIT_TYPE = "SeedVR2LoadDiTModel"
RIFE_TYPE = "RIFE VFI"
VIDEO_COMPONENTS_TYPE = "GetVideoComponents"


def max_short_side() -> int:
    raw = os.environ.get("LUMEN_GPU_MAX_SHORT_SIDE", str(MAX_SHORT_SIDE))
    try:
        value = int(raw)
    except ValueError:
        return MAX_SHORT_SIDE
    return max(16, value)


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def should_skip_upscale(job_input: dict[str, Any] | None) -> bool:
    """fps-only jobs still hit the Hub interpolation workflow, which always runs SeedVR2."""
    if not job_input:
        return False
    skip = _as_bool(job_input.get("skip_upscale"))
    if skip is True:
        return True
    scale_changed = _as_bool(job_input.get("scale_changed"))
    fps_changed = _as_bool(job_input.get("fps_changed"))
    return scale_changed is False and fps_changed is True


def requested_resolution(job_input: dict[str, Any] | None) -> int | None:
    if not job_input:
        return None
    raw = job_input.get("resolution")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if raw <= 0:
        return None
    return min(int(raw), max_short_side())


def cuda_alloc_conf() -> str:
    return os.environ.get("PYTORCH_CUDA_ALLOC_CONF") or "expandable_segments:True"


def apply_cuda_alloc() -> None:
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", cuda_alloc_conf())


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _vram_profile(resolution: int) -> dict[str, Any]:
    if resolution >= 2160:
        return {
            "batch_size": 1,
            "encode_tile_size": 256,
            "decode_tile_size": 256,
            "tile_overlap": 32,
            "blocks_to_swap": 36,
        }
    if resolution >= 1440:
        return {
            "batch_size": 1,
            "encode_tile_size": 512,
            "decode_tile_size": 512,
            "tile_overlap": 64,
            "blocks_to_swap": 32,
        }
    return {
        "batch_size": 5,
        "encode_tile_size": 512,
        "decode_tile_size": 512,
        "tile_overlap": 64,
        "blocks_to_swap": 32,
    }


def _node_type(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    class_type = node.get("class_type")
    return class_type if isinstance(class_type, str) else ""


def _node_inputs(node: dict[str, Any]) -> dict[str, Any]:
    inputs = node.get("inputs")
    if not isinstance(inputs, dict):
        inputs = {}
        node["inputs"] = inputs
    return inputs


def _resolution_from_prompt(prompt: dict[str, Any], job_input: dict[str, Any] | None) -> int:
    requested = requested_resolution(job_input)
    if requested is not None:
        return requested
    cap = max_short_side()
    for node in prompt.values():
        if _node_type(node) != UPSCALER_TYPE:
            continue
        current = _as_int(_node_inputs(node).get("resolution"), cap)
        return min(max(16, current), cap)
    return cap


def bypass_seedvr2(prompt: dict[str, Any]) -> dict[str, Any]:
    """Rewire RIFE onto the source frames and drop SeedVR2 so interpolation does not upscale."""
    components_id: str | None = None
    rife_ids: list[str] = []
    drop_ids: list[str] = []
    for node_id, node in prompt.items():
        class_type = _node_type(node)
        if class_type == VIDEO_COMPONENTS_TYPE:
            components_id = str(node_id)
        elif class_type == RIFE_TYPE:
            rife_ids.append(str(node_id))
        elif class_type in {UPSCALER_TYPE, VAE_TYPE, DIT_TYPE}:
            drop_ids.append(str(node_id))
    if not components_id or not rife_ids:
        return prompt
    for rife_id in rife_ids:
        node = prompt.get(rife_id)
        if isinstance(node, dict):
            _node_inputs(node)["frames"] = [components_id, 0]
    for node_id in drop_ids:
        prompt.pop(node_id, None)
    return prompt


def patch_seedvr2_prompt(
    prompt: dict[str, Any],
    job_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if should_skip_upscale(job_input):
        return bypass_seedvr2(prompt)
    resolution = _resolution_from_prompt(prompt, job_input)
    profile = _vram_profile(resolution)
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        class_type = _node_type(node)
        inputs = _node_inputs(node)
        if class_type == UPSCALER_TYPE:
            inputs["resolution"] = resolution
            inputs["batch_size"] = profile["batch_size"]
            inputs["offload_device"] = "cpu"
        elif class_type == VAE_TYPE:
            inputs["encode_tiled"] = True
            inputs["decode_tiled"] = True
            inputs["encode_tile_size"] = profile["encode_tile_size"]
            inputs["decode_tile_size"] = profile["decode_tile_size"]
            inputs["encode_tile_overlap"] = profile["tile_overlap"]
            inputs["decode_tile_overlap"] = profile["tile_overlap"]
            inputs["offload_device"] = "cpu"
        elif class_type == DIT_TYPE:
            inputs["blocks_to_swap"] = profile["blocks_to_swap"]
            inputs["swap_io_components"] = True
            inputs["offload_device"] = "cpu"
    return prompt


def cap_resolution(width: int, height: int, job_input: dict[str, Any] | None = None) -> int:
    requested = requested_resolution(job_input)
    if requested is not None:
        return requested
    shortest = min(int(width), int(height)) * 2
    return min(max(16, shortest), max_short_side())
