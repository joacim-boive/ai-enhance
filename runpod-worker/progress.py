"""Map ComfyUI sample progress onto the studio's running percent band."""

from __future__ import annotations


def comfy_progress_percent(value: float, maximum: float) -> int:
    if maximum <= 0:
        return 28
    ratio = max(0.0, min(1.0, float(value) / float(maximum)))
    return 28 + int(ratio * 52)
