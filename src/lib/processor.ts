import { unlink } from "node:fs/promises";
import { after } from "next/server";
import { absoluteUrl, isVercel, r2Enabled } from "./env";
import { enhanceVideo } from "./ffmpeg";
import {
  appendEvent,
  clearAbortController,
  getAbortController,
  loadJob,
  patchJob,
} from "./jobs";
import { jobOutputKey, mediaJobUrl } from "./keys";
import { createVersionClipFromJob, loadClip } from "./clips";
import { extractThumbnails, probeVideo } from "./probe";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createOutputUploadGrant,
  GPU_URL_EXPIRES_SEC,
  headObject,
  presignGetUrl,
  uploadFileToR2,
} from "./r2";
import {
  cancelGpuJob,
  getGpuJobStatus,
  gpuOutputLooksLikeBytes,
  isGpuConfigured,
  parseGpuObjectOutput,
  pollGpuJob,
  submitGpuJob,
} from "./runpod";
import {
  gpuHubResolution,
  isNoOp,
  outputSizeNotice,
  preferGpuEngine,
  resolveOutputTarget,
  type OutputTarget,
} from "./settings";
import { SAMPLE_PUBLIC_PATH, SAMPLE_SOURCE_PATH } from "./sample";
import { contentTypeForName, localPathFor, saveFromPath } from "./storage";
import { tmpPath } from "./tmp";
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

async function sourceInput(job: Job): Promise<string> {
  if (job.sourceObjectKey && r2Enabled()) {
    return presignGetUrl(job.sourceObjectKey, { expiresIn: GPU_URL_EXPIRES_SEC });
  }
  if (isHttpUrl(job.sourceUrl)) {
    return job.sourceUrl;
  }
  if (job.sourcePath.startsWith("/") && !job.sourcePath.startsWith("/api/")) {
    return job.sourcePath;
  }
  if (job.sourceUrl.startsWith("/") && !job.sourceUrl.startsWith("/api/")) {
    const absolute = absoluteUrl(job.sourceUrl);
    if (isHttpUrl(absolute)) {
      return absolute;
    }
    return job.sourceUrl;
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

  const input = await sourceInput(job);
  const meta = await probeVideo(input);
  const thumbs = await extractThumbnails(input, id, 8, meta.durationSec, {
    userId: job.userId,
    kind: "job",
  });
  await patchJob(id, { sourceMeta: meta, thumbs });

  if (isNoOp(meta, job.settings)) {
    await completeJob(id, "cpu", "Nothing to change — returning the original master.", null, {
      reuseSource: true,
    });
    return;
  }

  const target = resolveOutputTarget(meta, job.settings);
  const sizeNotice = outputSizeNotice(target);
  if (sizeNotice) {
    await appendEvent(id, {
      stage: "Reading source",
      message: sizeNotice.message,
      progress: 6,
      level: "warn",
    });
  }
  const preferGpu = preferGpuEngine({
    enginePreference: job.settings.enginePreference,
    gpuConfigured: isGpuConfigured() && r2Enabled(),
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
        message: reason.includes("VRAM")
          ? `${reason} Switching to high-quality CPU interpolation.`
          : `GPU unavailable (${reason}). Switching to high-quality CPU interpolation.`,
        progress: job.progress,
        level: "warn",
      });
      await runCpu(id, input, meta, job.settings, controller.signal, "high");
      usedEngine = "cpu";
    }
  } else {
    if (job.settings.enginePreference === "gpu" && (!isGpuConfigured() || !r2Enabled())) {
      fallbackReason = !r2Enabled()
        ? "Cloudflare R2 is not configured, so GPU cannot store a private master."
        : "GPU is not configured on this server.";
      await appendEvent(id, {
        stage: "Fallback",
        message: fallbackReason,
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
  target: OutputTarget,
): Promise<Engine> {
  if (!r2Enabled()) {
    throw new Error("Cloudflare R2 is required so the GPU worker can upload a private master.");
  }
  const meta = job.sourceMeta;
  if (!meta) {
    throw new Error("Missing source metadata");
  }
  const hub = gpuHubResolution(meta, target);

  await patchJob(job.id, {
    status: "warming",
    engine: "gpu",
    stage: "Warming GPU",
    progress: 8,
  });
  await appendEvent(job.id, {
    stage: "Warming GPU",
    message: hub.capped
      ? `Submitting to the RTX 4090. SeedVR2 short side is ${hub.resolution}px (the stock Hub would ask for ${hub.hubDefault}px and run out of VRAM).`
      : "Submitting to the SeedVR2 / RIFE worker on RTX 4090. First boot can take a few minutes.",
    progress: 8,
    level: "info",
  });

  const objectKey = jobOutputKey(job.userId, job.id);
  const grant = await createOutputUploadGrant({
    objectKey,
    contentType: "video/mp4",
  });
  await patchJob(job.id, {
    outputObjectKey: objectKey,
    outputMultipartUploadId: grant.multipart.uploadId,
  });

  const videoUrl = await gpuSourceUrl(job);
  const runpodJobId = await submitGpuJob({
    videoUrl,
    uploadUrl: grant.putUrl,
    objectKey,
    contentType: "video/mp4",
    multipart: grant.multipart,
    scaleChanged: target.scaleChanged,
    fpsChanged: target.fpsChanged,
    resolution: hub.resolution,
  });
  await patchJob(job.id, { runpodJobId, status: "processing", stage: "Enhancing on GPU" });
  await appendEvent(job.id, {
    stage: "Enhancing on GPU",
    message: "Worker streams the master to private R2. This app never downloads the file.",
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
    await persistGpuObject(job, output);
    return "gpu";
  } catch (error) {
    void cancelGpuJob(runpodJobId);
    throw error;
  } finally {
    clearInterval(pulse);
  }
}

async function gpuSourceUrl(job: Job): Promise<string> {
  if (job.sourceObjectKey && r2Enabled()) {
    return presignGetUrl(job.sourceObjectKey, { expiresIn: GPU_URL_EXPIRES_SEC });
  }
  if (job.sourcePath === SAMPLE_SOURCE_PATH || job.sourcePath.startsWith("public/")) {
    const publicPath =
      job.sourcePath === SAMPLE_SOURCE_PATH
        ? SAMPLE_PUBLIC_PATH
        : `/${job.sourcePath.replace(/^public\//, "")}`;
    const absolute = absoluteUrl(publicPath);
    if (isHttpUrl(absolute)) {
      return absolute;
    }
  }
  if (isHttpUrl(job.sourceUrl) && !job.sourceUrl.includes("/api/media/")) {
    return job.sourceUrl;
  }
  throw new Error("GPU jobs need a reachable source URL. Upload to R2 or use the public sample.");
}

async function persistGpuObject(job: Job, output: unknown): Promise<void> {
  const current = (await loadJob(job.id)) ?? job;
  const expected = jobOutputKey(current.userId, current.id);
  const parsed = parseGpuObjectOutput(output);
  if (!parsed) {
    if (gpuOutputLooksLikeBytes(output)) {
      throw new Error(
        "GPU returned inline bytes. Deploy the R2 wrap so the worker streams the mp4 to storage instead of sending it through Vercel.",
      );
    }
    throw new Error(
      "GPU finished without an object key. Deploy the R2 wrap handler so the worker uploads to the presigned URL.",
    );
  }
  if (parsed.objectKey !== expected) {
    throw new Error("GPU output key does not belong to this job.");
  }
  if (parsed.parts && parsed.uploadId) {
    await completeMultipartUpload({
      objectKey: expected,
      uploadId: parsed.uploadId,
      parts: parsed.parts,
    });
  } else if (current.outputMultipartUploadId) {
    await abortMultipartUpload(expected, current.outputMultipartUploadId).catch(() => undefined);
  }
  const head = await headObject(expected);
  if (!head || !head.contentLength) {
    throw new Error("Master is not in private storage yet.");
  }
  await patchJob(job.id, {
    outputPath: expected,
    outputObjectKey: expected,
    outputUrl: mediaJobUrl(job.id, "output"),
    outputBytes: head.contentLength,
    outputEtag: head.etag ?? parsed.etag,
    outputMultipartUploadId: null,
  });
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
  const job = await loadJob(id);
  if (!job) {
    throw new Error("Job missing while saving output");
  }
  if (r2Enabled()) {
    const objectKey = jobOutputKey(job.userId, job.id);
    const head = await uploadFileToR2({
      objectKey,
      filePath: localPath,
      contentType: "video/mp4",
    });
    await unlink(localPath).catch(() => undefined);
    const url = mediaJobUrl(id, "output");
    await patchJob(id, {
      outputPath: objectKey,
      outputObjectKey: objectKey,
      outputUrl: url,
      outputBytes: head.contentLength,
      outputEtag: head.etag,
    });
    return url;
  }
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
  let outputObjectKey = current.outputObjectKey;
  let outputMeta = current.outputMeta;
  let outputBytes = current.outputBytes;
  if (options?.reuseSource) {
    outputUrl = mediaJobUrl(id, "source");
    outputPath = current.sourcePath;
    outputObjectKey = current.sourceObjectKey;
    outputMeta = current.sourceMeta;
    outputBytes = current.sourceMeta?.sizeBytes ?? current.outputBytes;
  } else if (outputObjectKey && r2Enabled()) {
    try {
      outputMeta = await probeVideo(
        await presignGetUrl(outputObjectKey, { expiresIn: 3600 }),
      );
    } catch {
      outputMeta = outputMeta ?? null;
    }
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
    outputObjectKey,
    outputMeta,
    outputBytes,
    completedAt: Date.now(),
    fallbackReason,
    error: null,
  });
  await appendEvent(id, {
    stage: "Ready",
    message: message ?? "Master is ready to preview and download. It’s saved in your library.",
    progress: 100,
    level: "success",
  });
  if (!options?.reuseSource) {
    const latest = await loadJob(id);
    if (latest?.sourceClipId && latest.outputUrl) {
      const parent = await loadClip(latest.sourceClipId);
      if (parent) {
        try {
          const version = await createVersionClipFromJob(latest, parent);
          if (latest.outputClipId !== version.id) {
            await patchJob(id, { outputClipId: version.id });
          }
        } catch (error) {
          console.error(`Could not record library version for ${id}`, error);
        }
      }
    }
  }
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
    await persistGpuObject(job, status.output);
    await completeJob(id, "gpu", null, null);
  } catch (error) {
    console.error(`GPU resume failed for ${id}`, error);
  }
}
