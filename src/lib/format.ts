export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) {
    return "—";
  }
  const rounded = Math.round(fps * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} fps` : `${rounded.toFixed(2)} fps`;
}

export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`;
}

export type ProbeRotationSource = {
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number | string; side_data_type?: string }[];
};

export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  return ((Math.round(degrees) % 360) + 360) % 360;
}

export function rotationFromProbe(stream: ProbeRotationSource): number {
  const matrix = stream.side_data_list?.find((entry) => {
    if (entry.rotation === undefined || entry.rotation === "") {
      return false;
    }
    return Number.isFinite(Number(entry.rotation));
  });
  if (matrix) {
    // ffprobe prints av_display_rotation_get(); ffmpeg autorotate negates it.
    return normalizeRotation(-Number(matrix.rotation));
  }
  const tag = stream.tags?.rotate;
  if (tag !== undefined && tag !== "") {
    const parsed = Number(tag);
    if (Number.isFinite(parsed)) {
      return normalizeRotation(parsed);
    }
  }
  return 0;
}

export function displaySize(
  width: number,
  height: number,
  rotation = 0,
): { width: number; height: number } {
  // Reels / Shorts / TikTok are coded portrait. Do not swap them.
  if (height > width) {
    return { width, height };
  }
  const turns = normalizeRotation(rotation);
  if (turns === 90 || turns === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function codedNeedsTranspose(width: number, height: number, rotation = 0): number {
  if (height > width) {
    return 0;
  }
  const turns = normalizeRotation(rotation);
  if (turns === 90 || turns === 270 || turns === 180) {
    return turns;
  }
  return 0;
}

export function transposeFilter(rotation = 0): string | null {
  const turns = normalizeRotation(rotation);
  if (turns === 90) {
    return "transpose=1";
  }
  if (turns === 180) {
    return "hflip,vflip";
  }
  if (turns === 270) {
    return "transpose=2";
  }
  return null;
}

export function aspectRatioForMeta(
  meta: { width?: number; height?: number } | null | undefined,
  fallback = "16 / 9",
): string {
  if (
    meta &&
    typeof meta.width === "number" &&
    typeof meta.height === "number" &&
    meta.width > 0 &&
    meta.height > 0
  ) {
    return `${meta.width} / ${meta.height}`;
  }
  return fallback;
}

export function compareFrameAspect(
  meta: { width?: number; height?: number } | null | undefined,
  mode: "split" | "side-by-side" | "toggle",
): string {
  const base = aspectRatioForMeta(meta);
  if (mode !== "side-by-side" || !meta?.width || !meta.height || meta.width <= 0 || meta.height <= 0) {
    return base;
  }
  return `${meta.width * 2} / ${meta.height}`;
}

export function aspectRatioNumber(aspect: string): number {
  const [width, height] = aspect.split("/").map((part) => Number(part.trim()));
  if (width > 0 && height > 0) {
    return width / height;
  }
  return 16 / 9;
}

export type MediaFrameStyle = {
  aspectRatio: string;
  width: string;
  maxHeight: string;
};

export function mediaFrameStyle(aspect: string, maxHeight = "75vh"): MediaFrameStyle {
  const ratio = aspectRatioNumber(aspect);
  return {
    aspectRatio: aspect,
    width: `min(100%, calc(${maxHeight} * ${ratio}))`,
    maxHeight,
  };
}

export function parseFrameRate(rate: string | undefined): number {
  if (!rate) {
    return 0;
  }
  if (rate.includes("/")) {
    const [num, den] = rate.split("/").map(Number);
    if (!den) {
      return num || 0;
    }
    return num / den;
  }
  return Number(rate) || 0;
}

export function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function evenFloor(value: number): number {
  const floored = Math.max(2, Math.floor(value));
  return floored % 2 === 0 ? floored : floored - 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) {
    return "—";
  }
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCodec(codec: string | null | undefined): string {
  if (!codec) {
    return "—";
  }
  const known: Record<string, string> = {
    h264: "H.264",
    avc1: "H.264",
    hevc: "H.265",
    h265: "H.265",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    aac: "AAC",
    opus: "Opus",
    mp3: "MP3",
    ac3: "AC-3",
    eac3: "E-AC-3",
    pcm_s16le: "PCM",
  };
  return known[codec.toLowerCase()] ?? codec;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  if (seconds < 10) {
    return "a few seconds";
  }
  if (seconds < 60) {
    return `~${Math.round(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `~${minutes} min`;
  }
  return `~${(minutes / 60).toFixed(1)} h`;
}
