"""Keep SeedVR2 inside 24 GB by tiling, swapping DiT blocks, and capping short side.

The Hub handler always sets resolution = min(width, height) * 2 and encodes with
batch_size 33 / VAE tiles 1024. A 4K clip becomes 8K and dies in Phase 1 with
`Allocation on device`.
"""

from __future__ import annotations

import math
import os
from typing import Any, NamedTuple

MAX_SHORT_SIDE = 2160
UPSCALER_TYPE = "SeedVR2VideoUpscaler"
VAE_TYPE = "SeedVR2LoadVAEModel"
DIT_TYPE = "SeedVR2LoadDiTModel"
RIFE_TYPE = "RIFE VFI"
VIDEO_COMPONENTS_TYPE = "GetVideoComponents"
COMBINE_TYPE = "VHS_VideoCombine"
SELECT_NTH_TYPE = "VHS_SelectEveryNthImage"
# RIFE VFI only accepts an integer multiplier. 24→60 is 2.5×, so 5× (120 fps)
# hits exact 60 fps timestamps. RIFE concatenates every output frame into one
# CPU tensor (~30 GB for a 10s 1080×1920 clip). The wrap splits the source into
# overlapping chunks so each 5× tensor fits this budget; quality stays on RIFE.
MAX_RIFE_MULTIPLIER = 8
RIFE_RAM_BUDGET_BYTES = 6 * 1024 * 1024 * 1024
RIFE_CHUNK_OVERLAP_FRAMES = 1


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


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not number or number <= 0:
        return None
    return number


class RifeFpsPlan(NamedTuple):
    multiplier: int
    rife_fps: float
    output_fps: float
    decimate: int
    resample: bool


def rife_ram_budget_bytes() -> int:
    raw = os.environ.get("LUMEN_RIFE_RAM_BUDGET_BYTES")
    if raw:
        try:
            return max(512 * 1024 * 1024, int(raw))
        except ValueError:
            pass
    return RIFE_RAM_BUDGET_BYTES


def rife_frame_bytes(width: int, height: int) -> int:
    return max(1, int(width)) * max(1, int(height)) * 3 * 4


def clip_source_frames(job_input: dict[str, Any] | None) -> int | None:
    if not job_input:
        return None
    duration = _as_float(job_input.get("duration"))
    if duration is None:
        duration = _as_float(job_input.get("duration_sec"))
    source = _as_float(job_input.get("source_fps"))
    if duration is None or source is None:
        return None
    return max(1, int(round(source * duration)))


def rife_working_dimensions(job_input: dict[str, Any] | None) -> tuple[int, int] | None:
    """Pixel size RIFE sees: source for fps-only, post-SeedVR2 when upscaling."""
    if not job_input:
        return None
    width = _as_int(job_input.get("width"), 0)
    height = _as_int(job_input.get("height"), 0)
    if width < 16 or height < 16:
        return None
    if should_skip_upscale(job_input):
        return width, height
    short = min(width, height)
    target_short = requested_resolution(job_input)
    if target_short is None:
        target_short = min(short * 2, max_short_side())
    if target_short <= short:
        return width, height
    scale = target_short / short
    return max(16, int(round(width * scale))), max(16, int(round(height * scale)))


def rife_chunk_source_frames(width: int, height: int, multiplier: int) -> int:
    """How many source frames keep a 5× IMAGE tensor under half the RAM budget."""
    budget = max(256 * 1024 * 1024, rife_ram_budget_bytes() // 2)
    per_source = rife_frame_bytes(width, height) * max(1, int(multiplier))
    return max(2, min(120, budget // max(per_source, 1)))


def rife_chunk_ranges(
    source_frames: int,
    chunk_frames: int,
    overlap: int = RIFE_CHUNK_OVERLAP_FRAMES,
) -> list[tuple[int, int]]:
    """Half-open [start, end) source ranges with 1-frame overlap between chunks."""
    total = max(0, int(source_frames))
    size = max(2, int(chunk_frames))
    if total <= 0:
        return []
    if total <= size:
        return [(0, total)]
    overlap = min(max(1, int(overlap)), size - 1)
    stride = size - overlap
    ranges: list[tuple[int, int]] = []
    start = 0
    while start < total:
        end = min(total, start + size)
        remaining = total - end
        if 0 < remaining <= overlap:
            end = total
        ranges.append((start, end))
        if end >= total:
            break
        start += stride
    return ranges


def job_rife_plan(job_input: dict[str, Any] | None) -> RifeFpsPlan | None:
    if not job_input:
        return None
    target = _as_float(job_input.get("fps"))
    if target is None:
        target = _as_float(job_input.get("target_fps"))
    source = _as_float(job_input.get("source_fps"))
    if source is None or target is None:
        return None
    return rife_fps_plan(source, target)


def wants_rife_preprocess(job_input: dict[str, Any] | None) -> bool:
    """Download, bake rotation, and maybe chunk before Hub sees the clip."""
    if not job_input:
        return False
    if _as_bool(job_input.get("fps_changed")) is False:
        return False
    target = _as_float(job_input.get("fps"))
    if target is None:
        target = _as_float(job_input.get("target_fps"))
    if target is None:
        return False
    source = _as_float(job_input.get("source_fps"))
    if source is None:
        return True
    return rife_fps_plan(source, target).multiplier >= 2


def needs_rife_chunking(
    job_input: dict[str, Any] | None,
    source_frames: int | None = None,
) -> bool:
    plan = job_rife_plan(job_input)
    if plan is None or plan.multiplier <= 1:
        return False
    dims = rife_working_dimensions(job_input)
    frames = source_frames if source_frames is not None else clip_source_frames(job_input)
    if dims is None or frames is None:
        return True
    width, height = dims
    return frames > rife_chunk_source_frames(width, height, plan.multiplier)


def rife_fps_plan(
    source_fps: float,
    target_fps: float,
    max_multiplier: int | None = None,
) -> RifeFpsPlan:
    """Integer RIFE multiplier that can land on an exact target fps.

    RIFE queries independent timesteps (i/multiplier). 24→60 uses 5× so
    0.4 and 0.8 exist. Large clips are split into overlapping chunks so that
    5× tensor stays in RAM; ffmpeg is only a safety net after RIFE.
    """
    cap = MAX_RIFE_MULTIPLIER if max_multiplier is None else int(max_multiplier)
    cap = max(1, min(MAX_RIFE_MULTIPLIER, cap))
    if source_fps <= 0 or target_fps <= 0:
        return RifeFpsPlan(2, max(target_fps, 1), max(target_fps, 1), 1, False)

    ratio = target_fps / source_fps
    if ratio <= 1.02:
        return RifeFpsPlan(
            1,
            source_fps,
            target_fps,
            1,
            abs(target_fps - source_fps) > 0.08,
        )

    for multiplier in range(2, cap + 1):
        dense = source_fps * multiplier
        step = dense / target_fps
        nearest = round(step)
        if nearest >= 1 and abs(step - nearest) <= 0.03:
            return RifeFpsPlan(
                multiplier,
                dense,
                target_fps,
                nearest,
                nearest > 1 or abs(dense - target_fps) > 0.08,
            )

    multiplier = min(cap, max(1, math.ceil(ratio - 1e-9)))
    dense = source_fps * multiplier
    return RifeFpsPlan(multiplier, dense, target_fps, 1, abs(dense - target_fps) > 0.08)


def rife_output_fps(source_fps: float, target_fps: float) -> tuple[int, float]:
    """RIFE multiplier and the dense combine fps (before any resample to target)."""
    plan = rife_fps_plan(source_fps, target_fps)
    return plan.multiplier, plan.rife_fps


def _fps_node_value(fps: float) -> int | float:
    rounded = round(fps)
    if abs(fps - rounded) < 0.02:
        return int(rounded)
    return round(fps, 3)


def apply_rife_fps(prompt: dict[str, Any], job_input: dict[str, Any] | None) -> dict[str, Any]:
    if not job_input:
        return prompt
    if _as_bool(job_input.get("fps_changed")) is False:
        return prompt
    target = _as_float(job_input.get("fps"))
    if target is None:
        target = _as_float(job_input.get("target_fps"))
    source = _as_float(job_input.get("source_fps"))
    multiplier = 2
    frame_rate: float | None = None
    plan: RifeFpsPlan | None = None
    if source is not None and target is not None:
        plan = rife_fps_plan(source, target)
        multiplier = plan.multiplier
        frame_rate = plan.output_fps if plan.decimate > 1 else plan.rife_fps
        extra = (
            f", keep every {plan.decimate} → {plan.output_fps:g} fps"
            if plan.decimate > 1
            else ""
        )
        print(
            f"Lumen wrap: RIFE {source:g}→{target:g} via {multiplier}× "
            f"({plan.rife_fps:g} fps){extra}",
            flush=True,
        )
    elif target is not None:
        frame_rate = target
    for node in prompt.values():
        class_type = _node_type(node)
        inputs = _node_inputs(node) if isinstance(node, dict) else {}
        if class_type == RIFE_TYPE:
            inputs["multiplier"] = multiplier
            inputs["ensemble"] = False
            inputs["fast_mode"] = True
            inputs["clear_cache_after_n_frames"] = 5
        elif class_type == COMBINE_TYPE and frame_rate is not None:
            inputs["frame_rate"] = _fps_node_value(frame_rate)
    if plan is not None and plan.decimate > 1:
        _insert_rife_decimate(prompt, plan)
    return prompt


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


def _unused_node_id(prompt: dict[str, Any]) -> str:
    index = 27
    while str(index) in prompt:
        index += 1
    return str(index)


def _insert_rife_decimate(prompt: dict[str, Any], plan: RifeFpsPlan) -> dict[str, Any]:
    """Keep every Nth RIFE frame in-graph so VHS encodes target fps, not 120."""
    rife_ids = {
        str(node_id)
        for node_id, node in prompt.items()
        if _node_type(node) == RIFE_TYPE
    }
    if not rife_ids:
        return prompt
    for node in list(prompt.values()):
        if _node_type(node) != COMBINE_TYPE or not isinstance(node, dict):
            continue
        inputs = _node_inputs(node)
        images = inputs.get("images")
        if not isinstance(images, list) or not images:
            continue
        rife_id = str(images[0])
        if rife_id not in rife_ids:
            continue
        nth_id = _unused_node_id(prompt)
        prompt[nth_id] = {
            "class_type": SELECT_NTH_TYPE,
            "inputs": {
                "images": [rife_id, 0],
                "select_every_nth": plan.decimate,
                "skip_first_images": 0,
            },
        }
        inputs["images"] = [nth_id, 0]
        inputs["frame_rate"] = _fps_node_value(plan.output_fps)
    return prompt


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
        return apply_rife_fps(bypass_seedvr2(prompt), job_input)
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
    return apply_rife_fps(prompt, job_input)


def cap_resolution(width: int, height: int, job_input: dict[str, Any] | None = None) -> int:
    requested = requested_resolution(job_input)
    if requested is not None:
        return requested
    shortest = min(int(width), int(height)) * 2
    return min(max(16, shortest), max_short_side())
