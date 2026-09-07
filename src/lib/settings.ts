import { even } from "./format";
import type {
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
  preset: "restore",
  scale: "2x",
  fps: "keep",
  denoise: true,
  sharpen: false,
  enginePreference: "auto",
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
    enginePreference: "auto",
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
};

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

export function resolveOutputTarget(
  meta: VideoMeta,
  settings: JobSettings,
): OutputTarget {
  let width = meta.width;
  let height = meta.height;

  switch (settings.scale) {
    case "2x":
      width = even(meta.width * 2);
      height = even(meta.height * 2);
      break;
    case "4x":
      width = even(meta.width * 4);
      height = even(meta.height * 4);
      break;
    case "1080p":
      ({ width, height } = fitWithin(meta.width, meta.height, 1920, 1080));
      break;
    case "1440p":
      ({ width, height } = fitWithin(meta.width, meta.height, 2560, 1440));
      break;
    case "4k":
      ({ width, height } = fitWithin(meta.width, meta.height, 3840, 2160));
      break;
    default:
      break;
  }

  const fps =
    settings.fps === "keep" ? roundFps(meta.fps) : Number(settings.fps);

  return {
    width,
    height,
    fps,
    scaleChanged: width !== even(meta.width) || height !== even(meta.height),
    fpsChanged: Math.abs(fps - meta.fps) > 0.2,
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

export function engineLabel(engine: "gpu" | "cpu" | null): string {
  if (engine === "gpu") {
    return "GPU · SeedVR2 + RIFE 4.9";
  }
  if (engine === "cpu") {
    return "CPU · Lanczos + motion interpolation";
  }
  return "Engine pending";
}

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
];

export const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
