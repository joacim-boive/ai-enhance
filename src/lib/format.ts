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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
