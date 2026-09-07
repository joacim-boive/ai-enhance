import { copyFile, readFile, writeFile } from "node:fs/promises";
import { enhanceVideo } from "./ffmpeg";
import {
  appendEvent,
  clearAbortController,
  getAbortController,
  loadJob,
  patchJob,
} from "./jobs";
import { outputPath } from "./paths";
import { extractThumbnails, probeVideo } from "./probe";
import {
  cancelGpuJob,
  extractVideoPayload,
  GPU_BASE64_LIMIT,
  isGpuConfigured,
  pollGpuJob,
  submitGpuJob,
} from "./runpod";
import { isNoOp, resolveOutputTarget } from "./settings";
import type { Engine, Job } from "./types";

const queue: string[] = [];
let draining = false;

export function enqueueJob(id: string): void {
  if (!queue.includes(id)) {
    queue.push(id);
  }
  void drain();
}

async function drain(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      continue;
    }
    try {
      await processJob(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await failJob(id, message);
    }
  }
  draining = false;
}

async function processJob(id: string): Promise<void> {
  const job = await loadJob(id);
  if (!job || job.status === "cancelled") {
    return;
  }
  const controller = getAbortController(id);
  await patchJob(id, {
    status: "probing",
    stage: "Reading source",
    startedAt: Date.now(),
    progress: 4,
  });
  await appendEvent(id, {
    stage: "Reading source",
    message: "Probing codec, resolution, and frame rate.",
    progress: 4,
    level: "info",
  });

  const meta = await probeVideo(job.sourcePath);
  const thumbs = await extractThumbnails(job.sourcePath, id);
  await patchJob(id, { sourceMeta: meta, thumbs });

  if (isNoOp(meta, job.settings)) {
    await copyFile(job.sourcePath, outputPath(id));
    await completeJob(id, "cpu", "Nothing to change — returning the original master.");
    return;
  }

  const target = resolveOutputTarget(meta, job.settings);
  const preferGpu =
    job.settings.enginePreference === "gpu" ||
    (job.settings.enginePreference === "auto" &&
      isGpuConfigured() &&
      target.scaleChanged);

  let usedEngine: Engine = "cpu";
  let fallbackReason: string | null = null;

  if (preferGpu && job.settings.enginePreference !== "cpu") {
    try {
      usedEngine = await runGpu({ ...job, sourceMeta: meta }, controller.signal, target);
    } catch (error) {
      if (controller.signal.aborted) {
        await patchJob(id, { status: "cancelled", stage: "Cancelled", error: "Cancelled" });
        return;
      }
      const reason = error instanceof Error ? error.message : "GPU failed";
      fallbackReason = reason;
      await appendEvent(id, {
        stage: "Fallback",
        message: `GPU unavailable (${reason}). Switching to high-quality CPU interpolation.`,
        progress: job.progress,
        level: "warn",
      });
      await runCpu(id, job.sourcePath, meta, job.settings, controller.signal, "high");
      usedEngine = "cpu";
    }
  } else {
    if (job.settings.enginePreference === "gpu" && !isGpuConfigured()) {
      fallbackReason = "GPU is not configured on this server.";
      await appendEvent(id, {
        stage: "Fallback",
        message: "No GPU key configured. Processing on CPU with Lanczos + motion interpolation.",
        progress: 8,
        level: "warn",
      });
    }
    try {
      await runCpu(id, job.sourcePath, meta, job.settings, controller.signal, "high");
    } catch (error) {
      if (controller.signal.aborted) {
        await patchJob(id, { status: "cancelled", stage: "Cancelled", error: "Cancelled" });
        return;
      }
      const reason = error instanceof Error ? error.message : "High-quality encode failed";
      await appendEvent(id, {
        stage: "Fallback",
        message: `${reason}. Retrying with a faster interpolator.`,
        progress: 20,
        level: "warn",
      });
      fallbackReason = reason;
      await runCpu(id, job.sourcePath, meta, job.settings, controller.signal, "fast");
    }
  }

  await completeJob(id, usedEngine, null, fallbackReason);
}

async function runGpu(
  job: Job,
  signal: AbortSignal,
  target: { scaleChanged: boolean; fpsChanged: boolean },
): Promise<Engine> {
  await patchJob(job.id, {
    status: "warming",
    engine: "gpu",
    stage: "Warming GPU",
    progress: 8,
  });
  await appendEvent(job.id, {
    stage: "Warming GPU",
    message: "Submitting to the SeedVR2 / RIFE worker. Cold start can take a minute.",
    progress: 8,
    level: "info",
  });

  const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
  const sourceSize = job.sourceMeta?.sizeBytes ?? 0;
  let videoUrl: string | undefined;
  let videoBase64: string | undefined;

  if (publicBase) {
    videoUrl = `${publicBase}${job.sourceUrl}`;
  } else if (sourceSize > 0 && sourceSize <= GPU_BASE64_LIMIT) {
    const buf = await readFile(job.sourcePath);
    videoBase64 = `data:video/mp4;base64,${buf.toString("base64")}`;
  } else {
    throw new Error(
      "Clip is too large for inline GPU upload. Set PUBLIC_BASE_URL or use a smaller file.",
    );
  }

  const runpodJobId = await submitGpuJob({
    videoUrl,
    videoBase64,
    scaleChanged: target.scaleChanged,
    fpsChanged: target.fpsChanged,
  });
  await patchJob(job.id, { runpodJobId, status: "processing", stage: "Enhancing on GPU" });
  await appendEvent(job.id, {
    stage: "Enhancing on GPU",
    message: "Worker is upscaling and interpolating frames.",
    progress: 18,
    level: "info",
  });

  let ticks = 18;
  const pulse = setInterval(() => {
    ticks = Math.min(88, ticks + 2);
    void patchJob(job.id, { progress: ticks, status: "processing", stage: "Enhancing on GPU" });
  }, 4000);

  try {
    const onAbort = () => {
      void cancelGpuJob(runpodJobId);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const output = await pollGpuJob(runpodJobId, signal);
    signal.removeEventListener("abort", onAbort);
    const payload = extractVideoPayload(output);
    if (!payload) {
      throw new Error("GPU finished but did not return a video payload");
    }
    await writeFile(outputPath(job.id), payload);
    return "gpu";
  } finally {
    clearInterval(pulse);
  }
}

async function runCpu(
  id: string,
  sourcePath: string,
  meta: Job["sourceMeta"],
  settings: Job["settings"],
  signal: AbortSignal,
  quality: "high" | "fast",
): Promise<void> {
  if (!meta) {
    throw new Error("Missing source metadata");
  }
  await patchJob(id, {
    status: "processing",
    engine: "cpu",
    stage: quality === "high" ? "Enhancing on CPU" : "Fast fallback encode",
    progress: 12,
  });
  await appendEvent(id, {
    stage: quality === "high" ? "Enhancing on CPU" : "Fast fallback encode",
    message:
      quality === "high"
        ? "Lanczos upscale and motion-compensated frame interpolation."
        : "Using blend interpolation after the high-quality pass failed.",
    progress: 12,
    level: quality === "high" ? "info" : "warn",
  });

  const dest = outputPath(id);
  await enhanceVideo({
    inputPath: sourcePath,
    outputPath: dest,
    meta,
    settings,
    quality,
    signal,
    onProgress: ({ ratio }) => {
      const progress = 12 + Math.round(ratio * 80);
      void patchJob(id, {
        progress,
        status: "processing",
        etaSec: estimateEta(meta.durationSec, ratio),
      });
    },
  });
}

function estimateEta(durationSec: number, ratio: number): number | null {
  if (ratio <= 0.02) {
    return Math.max(8, Math.round(durationSec * 4));
  }
  const remaining = (1 - ratio) * durationSec * 3;
  return Math.max(1, Math.round(remaining));
}

async function completeJob(
  id: string,
  engine: Engine,
  message: string | null,
  fallbackReason: string | null = null,
): Promise<void> {
  const dest = outputPath(id);
  let outputMeta = null;
  try {
    outputMeta = await probeVideo(dest);
  } catch {
    outputMeta = null;
  }
  await patchJob(id, {
    status: "complete",
    engine,
    stage: "Ready",
    progress: 100,
    etaSec: 0,
    outputPath: dest,
    outputUrl: `/api/media/${id}/output`,
    outputMeta,
    completedAt: Date.now(),
    fallbackReason,
    error: null,
  });
  await appendEvent(id, {
    stage: "Ready",
    message: message ?? "Master is ready to preview and download.",
    progress: 100,
    level: "success",
  });
  clearAbortController(id);
}

async function failJob(id: string, message: string): Promise<void> {
  const job = await loadJob(id);
  if (job?.status === "cancelled") {
    return;
  }
  await patchJob(id, {
    status: "failed",
    stage: "Failed",
    error: message,
    progress: job?.progress ?? 0,
  });
  await appendEvent(id, {
    stage: "Failed",
    message,
    progress: job?.progress ?? 0,
    level: "error",
  });
  clearAbortController(id);
}
