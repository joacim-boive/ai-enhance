import { even, evenFloor } from "./format";
import type {
  Engine,
  EnginePreference,
  FpsMode,
  JobSettings,
  QualityPreset,
  ScaleMode,
  VideoMeta,
} from "./types";

export type PresetDefinition = {
  id: Exclude<QualityPreset, "custom">;
  label: string;
  blurb: string;
  scale: ScaleMode;
  fps: FpsMode;
  denoise: boolean;
  sharpen: boolean;
};

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: "restore",
    label: "Restore",
    blurb: "2× upscale, gentle denoise, original cadence.",
    scale: "2x",
    fps: "keep",
    denoise: true,
    sharpen: false,
  },
  {
    id: "cinema",
    label: "Cinema 4K",
    blurb: "Fit to UHD, keep the source frame rate.",
    scale: "4k",
    fps: "keep",
    denoise: true,
    sharpen: true,
  },
  {
    id: "hfr",
    label: "High Frame Rate",
    blurb: "Interpolate to 60 fps at native resolution.",
    scale: "none",
    fps: "60",
    denoise: false,
    sharpen: false,
  },
  {
    id: "max",
    label: "Max",
    blurb: "4K + 60 fps. The full treatment.",
    scale: "4k",
    fps: "60",
    denoise: true,
    sharpen: true,
  },
];

export const SCALE_OPTIONS: { id: ScaleMode; label: string }[] = [
  { id: "none", label: "Source" },
  { id: "2x", label: "2×" },
  { id: "4x", label: "4×" },
  { id: "1080p", label: "1080p" },
  { id: "1440p", label: "1440p" },
  { id: "4k", label: "4K" },
];

export const FPS_OPTIONS: { id: FpsMode; label: string }[] = [
  { id: "keep", label: "Keep" },
  { id: "30", label: "30" },
  { id: "48", label: "48" },
  { id: "60", label: "60" },
  { id: "120", label: "120" },
];

export const DEFAULT_SETTINGS: JobSettings = {
  preset: "custom",
  scale: "none",
  fps: "keep",
  denoise: false,
  sharpen: false,
  enginePreference: "gpu",
};

export function settingsFromPreset(preset: QualityPreset): JobSettings {
  if (preset === "custom") {
    return { ...DEFAULT_SETTINGS, preset: "custom" };
  }
  const definition = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
  return {
    preset,
    scale: definition.scale,
    fps: definition.fps,
    denoise: definition.denoise,
    sharpen: definition.sharpen,
    enginePreference: "gpu",
  };
}

export function withCustomOverride(
  current: JobSettings,
  patch: Partial<Omit<JobSettings, "preset">>,
): JobSettings {
  return { ...current, ...patch, preset: "custom" };
}

export type OutputTarget = {
  width: number;
  height: number;
  fps: number;
  scaleChanged: boolean;
  fpsChanged: boolean;
  requestedWidth: number;
  requestedHeight: number;
  cappedAt8k: boolean;
  exceedsUhd: boolean;
};

/** 4K UHD. Warn when the result does not fit in this box (either orientation). */
export const UHD_LONG_SIDE = 3840;
export const UHD_SHORT_SIDE = 2160;
/** Hard cap. Nothing larger than 8K is allowed. */
export const MAX_OUTPUT_LONG_SIDE = 7680;
export const MAX_OUTPUT_SHORT_SIDE = 4320;

function fitsBox(width: number, height: number, maxLong: number, maxShort: number): boolean {
  return Math.max(width, height) <= maxLong && Math.min(width, height) <= maxShort;
}

function clampToBox(
  width: number,
  height: number,
  maxLong: number,
  maxShort: number,
): { width: number; height: number } {
  const scale = Math.min(maxLong / Math.max(width, height), maxShort / Math.min(width, height), 1);
  return {
    width: evenFloor(width * scale),
    height: evenFloor(height * scale),
  };
}

export function exceedsUhd(width: number, height: number): boolean {
  return !fitsBox(width, height, UHD_LONG_SIDE, UHD_SHORT_SIDE);
}

export function exceeds8k(width: number, height: number): boolean {
  return !fitsBox(width, height, MAX_OUTPUT_LONG_SIDE, MAX_OUTPUT_SHORT_SIDE);
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 4);
  const nextWidth = even(width * Math.max(scale, 1));
  const nextHeight = even(height * Math.max(scale, 1));
  return { width: nextWidth, height: nextHeight };
}

export function requestedOutputSize(
  meta: VideoMeta,
  scale: ScaleMode,
): { width: number; height: number } {
  switch (scale) {
    case "2x":
      return { width: even(meta.width * 2), height: even(meta.height * 2) };
    case "4x":
      return { width: even(meta.width * 4), height: even(meta.height * 4) };
    case "1080p":
      return fitWithin(meta.width, meta.height, 1920, 1080);
    case "1440p":
      return fitWithin(meta.width, meta.height, 2560, 1440);
    case "4k":
      return fitWithin(meta.width, meta.height, 3840, 2160);
    default:
      return { width: even(meta.width), height: even(meta.height) };
  }
}

export function scaleExceeds8k(meta: VideoMeta, scale: ScaleMode): boolean {
  const requested = requestedOutputSize(meta, scale);
  return exceeds8k(requested.width, requested.height);
}

export function resolveOutputTarget(
  meta: VideoMeta,
  settings: JobSettings,
): OutputTarget {
  const requested = requestedOutputSize(meta, settings.scale);
  const capped = exceeds8k(requested.width, requested.height)
    ? clampToBox(requested.width, requested.height, MAX_OUTPUT_LONG_SIDE, MAX_OUTPUT_SHORT_SIDE)
    : requested;

  const fps =
    settings.fps === "keep" ? roundFps(meta.fps) : Number(settings.fps);

  return {
    width: capped.width,
    height: capped.height,
    fps,
    scaleChanged: capped.width !== even(meta.width) || capped.height !== even(meta.height),
    fpsChanged: Math.abs(fps - meta.fps) > 0.2,
    requestedWidth: requested.width,
    requestedHeight: requested.height,
    cappedAt8k: exceeds8k(requested.width, requested.height),
    exceedsUhd: exceedsUhd(capped.width, capped.height),
  };
}

export type OutputSizeNotice = {
  tone: "warn";
  message: string;
};

export function outputSizeNotice(target: OutputTarget): OutputSizeNotice | null {
  const size = `${target.width}×${target.height}`;
  if (target.cappedAt8k) {
    return {
      tone: "warn",
      message: `Capped at 8K (${size}). ${target.requestedWidth}×${target.requestedHeight} is not allowed.`,
    };
  }
  if (target.exceedsUhd) {
    return {
      tone: "warn",
      message: `Above 4K (${size}). 2× or 4× on UHD is easy to pick by mistake — switch to Source or 4K unless you really want 8K.`,
    };
  }
  return null;
}

/** Shortest output side the RTX 4090 worker can hold after VRAM tiling. */
export const GPU_MAX_SHORT_SIDE = 2160;

export type GpuHubResolution = {
  resolution: number;
  hubDefault: number;
  capped: boolean;
};

export function gpuHubResolution(meta: VideoMeta, target: OutputTarget): GpuHubResolution {
  const hubDefault = even(Math.min(meta.width, meta.height) * 2);
  const requested = target.scaleChanged
    ? Math.min(target.width, target.height)
    : Math.min(meta.width, meta.height);
  const resolution = even(Math.max(16, Math.min(requested, GPU_MAX_SHORT_SIDE)));
  return {
    resolution,
    hubDefault,
    capped: resolution < hubDefault,
  };
}

export function roundFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    return 24;
  }
  const candidates = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  let best = fps;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate - fps);
    if (delta < bestDelta && delta < 0.08) {
      best = candidate;
      bestDelta = delta;
    }
  }
  if (bestDelta < 0.08) {
    return best;
  }
  return Math.round(fps * 1000) / 1000;
}

export function isNoOp(meta: VideoMeta, settings: JobSettings): boolean {
  const target = resolveOutputTarget(meta, settings);
  return (
    !target.scaleChanged &&
    !target.fpsChanged &&
    !settings.denoise &&
    !settings.sharpen
  );
}

export function preferGpuEngine(input: {
  enginePreference: EnginePreference;
  gpuConfigured: boolean;
  scaleChanged: boolean;
  fpsChanged: boolean;
}): boolean {
  if (input.enginePreference === "cpu" || !input.gpuConfigured) {
    return false;
  }
  if (input.enginePreference === "gpu") {
    return true;
  }
  return input.scaleChanged || input.fpsChanged;
}

export function engineLabel(engine: Engine | null, settings?: JobSettings | null): string {
  if (engine === "gpu") {
    return gpuEngineLabel(settings);
  }
  if (engine === "cpu") {
    return "CPU · Lanczos + motion interpolation";
  }
  return "Engine pending";
}

export function gpuEngineLabel(settings?: JobSettings | null): string {
  const fpsOnly = Boolean(settings && settings.fps !== "keep" && settings.scale === "none");
  const scaleOnly = Boolean(settings && settings.fps === "keep" && settings.scale !== "none");
  if (fpsOnly) {
    return "GPU · RIFE 4.9";
  }
  if (scaleOnly) {
    return "GPU · SeedVR2";
  }
  return "GPU · SeedVR2 + RIFE 4.9";
}

export function enhanceEngineCopy(target: {
  fpsChanged: boolean;
  scaleChanged: boolean;
}): string {
  if (target.fpsChanged && !target.scaleChanged) {
    return "Frame interpolation runs RIFE 4.9 on the RTX 4090 to the selected frame rate, including 24→60. SeedVR2 is skipped.";
  }
  if (target.scaleChanged && !target.fpsChanged) {
    return "Upscale runs SeedVR2 on the RTX 4090. Results above 4K show a warning; nothing above 8K is allowed.";
  }
  if (target.fpsChanged && target.scaleChanged) {
    return "GPU uses SeedVR2 then RIFE 4.9 on an RTX 4090. Results above 4K show a warning; nothing above 8K is allowed.";
  }
  return "GPU uses SeedVR2 + RIFE 4.9 on an RTX 4090. Results above 4K show a warning; nothing above 8K is allowed.";
}

export function treatmentLabel(settings: JobSettings | null | undefined): string {
  if (!settings) {
    return "Original";
  }
  if (settings.preset !== "custom") {
    const preset = PRESETS.find((item) => item.id === settings.preset);
    if (preset) {
      return preset.label;
    }
  }
  const bits: string[] = [];
  if (settings.scale !== "none") {
    bits.push(SCALE_OPTIONS.find((item) => item.id === settings.scale)?.label ?? settings.scale);
  }
  if (settings.fps !== "keep") {
    bits.push(`${settings.fps} fps`);
  }
  if (settings.denoise) {
    bits.push("Denoise");
  }
  if (settings.sharpen) {
    bits.push("Sharpen");
  }
  return bits.length > 0 ? bits.join(" · ") : "Source";
}

export function treatmentSlug(settings: JobSettings | null | undefined): string {
  if (!settings) {
    return "original";
  }
  const parts: string[] = [];
  if (settings.scale !== "none") {
    parts.push(settings.scale);
  }
  if (settings.fps !== "keep") {
    parts.push(`${settings.fps}fps`);
  }
  if (settings.denoise) {
    parts.push("denoise");
  }
  if (settings.sharpen) {
    parts.push("sharpen");
  }
  return parts.join("-") || (settings.preset === "custom" ? "source" : settings.preset);
}

export function versionFileName(originalName: string, settings: JobSettings | null | undefined): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot >= 0 ? originalName.slice(dot) : ".mp4";
  const base = dot >= 0 ? originalName.slice(0, dot) : originalName;
  const slug = treatmentSlug(settings);
  return `${base}-${slug}${ext || ".mp4"}`;
}

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
];

export const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_FORM_UPLOAD_BYTES = 80 * 1024 * 1024;
