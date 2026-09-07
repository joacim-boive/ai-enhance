import { spawn, type ChildProcess } from "node:child_process";
import { ffmpegArgs, buildVideoFilters } from "./ffmpeg-graph";
import { resolveOutputTarget } from "./settings";
import type { JobSettings, VideoMeta } from "./types";

export type FfmpegProgress = {
  ratio: number;
  outTimeSec: number;
};

export type EnhanceVideoInput = {
  inputPath: string;
  outputPath: string;
  meta: VideoMeta;
  settings: JobSettings;
  quality: "high" | "fast";
  signal: AbortSignal;
  onProgress: (progress: FfmpegProgress) => void;
};

const running = new Map<string, ChildProcess>();

export function parseProgressLine(
  chunk: string,
  durationSec: number,
): FfmpegProgress | null {
  const timeMatch = chunk.match(/out_time_ms=(\d+)/);
  if (!timeMatch) {
    const usMatch = chunk.match(/out_time_us=(\d+)/);
    if (!usMatch) {
      return null;
    }
    const outTimeSec = Number(usMatch[1]) / 1_000_000;
    const ratio = durationSec > 0 ? Math.min(0.99, outTimeSec / durationSec) : 0;
    return { ratio, outTimeSec };
  }
  const outTimeSec = Number(timeMatch[1]) / 1_000_000;
  const ratio = durationSec > 0 ? Math.min(0.99, outTimeSec / durationSec) : 0;
  return { ratio, outTimeSec };
}

export async function enhanceVideo(input: EnhanceVideoInput): Promise<void> {
  const target = resolveOutputTarget(input.meta, input.settings);
  const filters = buildVideoFilters({
    width: target.width,
    height: target.height,
    fps: target.fps,
    scaleChanged: target.scaleChanged,
    fpsChanged: target.fpsChanged,
    denoise: input.settings.denoise,
    sharpen: input.settings.sharpen,
    quality: input.quality,
  });
  const args = ffmpegArgs({
    inputPath: input.inputPath,
    outputPath: input.outputPath,
    filters,
    hasAudio: Boolean(input.meta.audioCodec),
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    running.set(input.outputPath, child);
    let stderr = "";

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (buf: Buffer) => {
      const parsed = parseProgressLine(buf.toString(), input.meta.durationSec);
      if (parsed) {
        input.onProgress(parsed);
      }
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
      if (stderr.length > 32_000) {
        stderr = stderr.slice(-16_000);
      }
    });
    child.on("error", (error) => {
      running.delete(input.outputPath);
      input.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      running.delete(input.outputPath);
      input.signal.removeEventListener("abort", onAbort);
      if (input.signal.aborted) {
        reject(new Error("Cancelled"));
        return;
      }
      if (code !== 0) {
        reject(new Error(extractFfmpegError(stderr) || `ffmpeg exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

function extractFfmpegError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = [...lines].reverse().find((line) =>
    /error|invalid|failed|not found|unable/i.test(line),
  );
  return useful ?? lines.at(-1) ?? "";
}
