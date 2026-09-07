import { unlink } from "node:fs/promises";
import { after } from "next/server";
import { absoluteUrl, isVercel } from "./env";
import { enhanceVideo } from "./ffmpeg";
import { writeTempFile } from "./ingest";
import { tmpPath } from "./tmp";
import {
  appendEvent,
  clearAbortController,
  getAbortController,
  loadJob,
  patchJob,
} from "./jobs";
import { extractThumbnails, probeVideo } from "./probe";
import {
  cancelGpuJob,
  getGpuJobStatus,
  GPU_BASE64_LIMIT,
  isGpuConfigured,
  materializeGpuOutput,
  pollGpuJob,
  submitGpuJob,
} from "./runpod";
import { isNoOp, preferGpuEngine, resolveOutputTarget } from "./settings";
import { contentTypeForName, localPathFor, saveFromPath } from "./storage";
import type { Engine, Job } from "./types";
import { isHttpUrl } from "./url";

const queue: string[] = [];
let draining = false;

export function startJob(id: string): void {
  if (isVercel()) {
    after(() => processJobSafe(id));
    return;
  }
  enqueueJob(id);
}

export async function processJobSafe(id: string): Promise<void> {
  try {
    await processJob(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Job ${id} failed`, error);
    await failJob(id, message);
  }
}

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
    await processJobSafe(id);
  }
  draining = false;
}

function sourceInput(job: Job): string {
  if (isHttpUrl(job.sourceUrl)) {
    return job.sourceUrl;
  }
  if (job.sourcePath.startsWith("/") && !job.sourcePath.startsWith("/api/")) {
    return job.sourcePath;
  }
  return localPathFor(job.sourcePath);
}

async function processJob(id: string): Promise<void> {
  const job = await loadJob(id);
  if (!job || job.status === "cancelled" || job.status === "complete") {
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

  const input = sourceInput(job);
  const meta = await probeVideo(input);
  const thumbs = await extractThumbnails(input, id, 8, meta.durationSec);
  await patchJob(id, { sourceMeta: meta, thumbs });

  if (isNoOp(meta, job.settings)) {
    await completeJob(id, "cpu", "Nothing to change — returning the original master.", null, {
      reuseSource: true,
    });
    return;
  }

  const target = resolveOutputTarget(meta, job.settings);
  const preferGpu = preferGpuEngine({
    enginePreference: job.settings.enginePreference,
    gpuConfigured: isGpuConfigured(),
    scaleChanged: target.scaleChanged,
    fpsChanged: target.fpsChanged,
  });

  let usedEngine: Engine = "cpu";
  let fallbackReason: string | null = null;

  if (preferGpu) {
    try {
      usedEngine = await runGpu({ ...job, sourceMeta: meta }, controller.signal, target);
    } catch (error) {
      if (controller.signal.aborted) {
        await patchJob(id, { status: "cancelled", stage: "Cancelled", error: "Cancelled" });
        return;
      }
      const latest = await loadJob(id);
      if (latest?.status === "complete") {
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
      await runCpu(id, input, meta, job.settings, controller.signal, "high");
      usedEngine = "cpu";
    }
  } else {
    if (job.settings.enginePreference === "gpu" && !isGpuConfigured()) {
      fallbackReason = "GPU is not configured on this server.";
      await appendEvent(id, {
        stage: "Fallback",
        message: "GPU key is missing on this deployment. Processing on CPU with Lanczos + motion interpolation.",
        progress: 8,
        level: "warn",
      });
    }
    try {
      await runCpu(id, input, meta, job.settings, controller.signal, "high");
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
      await runCpu(id, input, meta, job.settings, controller.signal, "fast");
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

  const publicSource = isHttpUrl(job.sourceUrl)
    ? job.sourceUrl
    : absoluteUrl(job.sourceUrl);
  const sourceSize = job.sourceMeta?.sizeBytes ?? 0;
  let videoUrl: string | undefined;
  let videoBase64: string | undefined;

  if (isHttpUrl(publicSource)) {
    videoUrl = publicSource;
  } else if (sourceSize > 0 && sourceSize <= GPU_BASE64_LIMIT) {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(sourceInput(job));
    videoBase64 = `data:video/mp4;base64,${buf.toString("base64")}`;
  } else {
    throw new Error(
      "Clip is too large for inline GPU upload. Connect Vercel Blob or set PUBLIC_BASE_URL.",
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
    const payload = await materializeGpuOutput(output);
    const tmp = await writeTempFile(`${job.id}-gpu.mp4`, payload);
    await persistOutput(job.id, tmp, job.name);
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

  const dest = tmpPath(`${id}-out.mp4`);
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
  await persistOutput(id, dest, "enhanced.mp4");
}

async function persistOutput(id: string, localPath: string, name: string): Promise<string> {
  const url = await saveFromPath(`outputs/${id}.mp4`, localPath, contentTypeForName(name));
  await unlink(localPath).catch(() => undefined);
  await patchJob(id, {
    outputPath: `outputs/${id}.mp4`,
    outputUrl: url,
  });
  return url;
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
  options?: { reuseSource?: boolean },
): Promise<void> {
  const current = await loadJob(id);
  if (!current || current.status === "complete" || current.status === "cancelled") {
    return;
  }
  let outputUrl = current.outputUrl;
  let outputPath = current.outputPath;
  let outputMeta = current.outputMeta;
  if (options?.reuseSource) {
    outputUrl = current.sourceUrl;
    outputPath = current.sourcePath;
    outputMeta = current.sourceMeta;
  } else if (outputPath) {
    try {
      outputMeta = await probeVideo(
        isHttpUrl(outputUrl ?? "") ? (outputUrl as string) : localPathFor(outputPath),
      );
    } catch {
      outputMeta = outputMeta ?? null;
    }
  }
  await patchJob(id, {
    status: "complete",
    engine,
    stage: "Ready",
    progress: 100,
    etaSec: 0,
    outputPath,
    outputUrl,
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
  if (job?.status === "cancelled" || job?.status === "complete") {
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

export async function resumeGpuJob(id: string): Promise<void> {
  const job = await loadJob(id);
  if (
    !job?.runpodJobId ||
    job.status === "complete" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return;
  }
  if (job.engine !== "gpu") {
    return;
  }
  try {
    const status = await getGpuJobStatus(job.runpodJobId);
    if (status.status !== "COMPLETED") {
      return;
    }
    const payload = await materializeGpuOutput(status.output);
    const tmp = await writeTempFile(`${job.id}-gpu.mp4`, payload);
    await persistOutput(job.id, tmp, job.name);
    await completeJob(id, "gpu", null, null);
  } catch (error) {
    console.error(`GPU resume failed for ${id}`, error);
  }
}
