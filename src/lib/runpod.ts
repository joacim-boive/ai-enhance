import { missingGpuKeyMessage, r2Enabled, runtimeEnv } from "./env";
import { GPU_QUEUE_HARD_TIMEOUT_MS, shouldExtendGpuQueueWait } from "./job-lifecycle";
import type { HealthStatus } from "./types";

const DEFAULT_ENDPOINT = "tbsk82cmm6azwh";
const STUCK_IMAGE_PULL_ENDPOINT = "npjpz24ig6c47j";

export function runpodConfig(): {
  apiKey: string | null;
  endpointId: string;
} {
  const apiKey = runtimeEnv("RUNPOD_API_KEY") ?? null;
  const configuredEndpoint = runtimeEnv("RUNPOD_ENDPOINT_ID");
  const endpointId =
    !configuredEndpoint || configuredEndpoint === STUCK_IMAGE_PULL_ENDPOINT
      ? DEFAULT_ENDPOINT
      : configuredEndpoint;
  return { apiKey, endpointId };
}

export function isGpuConfigured(): boolean {
  return Boolean(runpodConfig().apiKey);
}

type RunpodRunResponse = {
  id?: string;
  status?: string;
  error?: string;
};

type RunpodStatusResponse = {
  id?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: unknown;
  error?: string;
};

export function gpuShouldAlert(input: {
  configured: boolean;
  r2Ready: boolean;
  reachable: boolean;
  httpOk: boolean;
  ready: boolean;
  throttled: number;
}): boolean {
  if (!input.configured) {
    return false;
  }
  if (!input.r2Ready || !input.reachable || !input.httpOk) {
    return true;
  }
  return input.throttled > 0 && !input.ready;
}

export async function gpuHealth(): Promise<HealthStatus["gpu"]> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return {
      configured: false,
      endpointId: null,
      ready: false,
      alert: false,
      workers: null,
      message: missingGpuKeyMessage(),
    };
  }
  const r2Ready = r2Enabled();
  // Do not GET Runpod /health from the studio poll. That ping can reset
  // idle timeout and leave a 4090 billed after a job (or a config change).
  return {
    configured: true,
    endpointId,
    ready: false,
    alert: !r2Ready,
    workers: null,
    message: r2Ready
      ? "GPU is on demand. The first enhance job warms an RTX 4090."
      : "GPU is configured, but Cloudflare R2 is missing. The worker cannot land a private master without a presigned upload.",
  };
}

type RunpodHealth = {
  workers?: {
    idle?: number;
    running?: number;
    initializing?: number;
    throttled?: number;
    ready?: number;
  };
};

async function fetchGpuWorkers(): Promise<{
  idle: number;
  running: number;
  initializing: number;
  throttled: number;
} | null> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return null;
  }
  try {
    const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as RunpodHealth;
    return {
      idle: data.workers?.idle ?? 0,
      running: data.workers?.running ?? 0,
      initializing: data.workers?.initializing ?? 0,
      throttled: data.workers?.throttled ?? 0,
    };
  } catch {
    return null;
  }
}

export function gpuTaskType(
  scaleChanged: boolean,
  fpsChanged: boolean,
): "upscale" | "upscale_and_interpolation" {
  if (fpsChanged) {
    return "upscale_and_interpolation";
  }
  if (scaleChanged) {
    return "upscale";
  }
  return "upscale_and_interpolation";
}

/** Hub has no interpolation-only workflow; the wrap strips SeedVR2 when this is true. */
export function gpuSkipUpscale(scaleChanged: boolean, fpsChanged: boolean): boolean {
  return fpsChanged && !scaleChanged;
}

export function gpuWarmupMessage(input: {
  scaleChanged: boolean;
  fpsChanged: boolean;
  hubCapped: boolean;
  hubResolution: number;
  hubDefault: number;
}): string {
  if (gpuSkipUpscale(input.scaleChanged, input.fpsChanged)) {
    return "Submitting to the RTX 4090 for RIFE interpolation only. SeedVR2 upscale is skipped.";
  }
  if (input.hubCapped) {
    return `Submitting to the RTX 4090. SeedVR2 short side is ${input.hubResolution}px (the stock Hub would ask for ${input.hubDefault}px and run out of VRAM).`;
  }
  return "Submitting to the SeedVR2 / RIFE worker on RTX 4090. First boot can take a few minutes.";
}

export type GpuMultipartGrant = {
  uploadId: string;
  partSize: number;
  partUrls: string[];
};

export type GpuObjectOutput = {
  objectKey: string;
  byteSize: number;
  etag: string | null;
  uploadId: string | null;
  parts: { partNumber: number; etag: string }[] | null;
};

export async function submitGpuJob(input: {
  videoUrl: string;
  uploadUrl: string;
  objectKey: string;
  contentType: string;
  multipart: GpuMultipartGrant;
  scaleChanged: boolean;
  fpsChanged: boolean;
  fps?: number;
  sourceFps?: number;
  resolution: number;
}): Promise<string> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    throw new Error("GPU is not configured");
  }
  const body: Record<string, unknown> = {
    task_type: gpuTaskType(input.scaleChanged, input.fpsChanged),
    network_volume: false,
    video_url: input.videoUrl,
    upload_url: input.uploadUrl,
    object_key: input.objectKey,
    content_type: input.contentType,
    resolution: input.resolution,
    scale_changed: input.scaleChanged,
    fps_changed: input.fpsChanged,
    skip_upscale: gpuSkipUpscale(input.scaleChanged, input.fpsChanged),
    fps: input.fps,
    source_fps: input.sourceFps,
    multipart: {
      uploadId: input.multipart.uploadId,
      partSize: input.multipart.partSize,
      partUrls: input.multipart.partUrls,
    },
  };
  const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: body }),
  });
  const data = (await response.json()) as RunpodRunResponse;
  if (!response.ok || !data.id) {
    throw new Error(data.error || `Runpod submit failed (${response.status})`);
  }
  return data.id;
}

export async function getGpuJobStatus(runpodJobId: string): Promise<RunpodStatusResponse> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    throw new Error("GPU is not configured");
  }
  const response = await fetch(
    `https://api.runpod.ai/v2/${endpointId}/status/${runpodJobId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );
  const data = (await response.json()) as RunpodStatusResponse;
  if (!response.ok) {
    throw new Error(data.error || `Runpod status failed (${response.status})`);
  }
  return data;
}

export async function pollGpuJob(
  jobId: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (!runpodConfig().apiKey) {
    throw new Error("GPU is not configured");
  }
  const started = Date.now();
  while (!signal.aborted) {
    const data = await getGpuJobStatus(jobId);
    if (data.status === "COMPLETED") {
      const completedError = gpuOutputError(data.output);
      if (completedError) {
        throw new Error(gpuFailureMessage(completedError));
      }
      return data.output;
    }
    if (
      data.status === "FAILED" ||
      data.status === "CANCELLED" ||
      data.status === "TIMED_OUT"
    ) {
      throw new Error(gpuFailureMessage(collectGpuErrorText(data), data.status));
    }
    if (data.status === "IN_QUEUE" || !data.status) {
      const elapsedMs = Date.now() - started;
      if (elapsedMs > GPU_QUEUE_TIMEOUT_MS) {
        const workers = await fetchGpuWorkers();
        if (
          !shouldExtendGpuQueueWait({
            elapsedMs,
            timeoutMs: GPU_QUEUE_TIMEOUT_MS,
            hardTimeoutMs: GPU_QUEUE_HARD_TIMEOUT_MS,
            workers,
          })
        ) {
          throw new Error(GPU_QUEUE_STUCK_MESSAGE);
        }
      }
    }
    await sleep(2000, signal);
  }
  throw new Error("Cancelled");
}

export async function cancelGpuJob(runpodJobId: string): Promise<void> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return;
  }
  await fetch(`https://api.runpod.ai/v2/${endpointId}/cancel/${runpodJobId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function nestedRecord(output: unknown): Record<string, unknown> | null {
  const record = asRecord(output);
  if (!record) {
    return null;
  }
  const nested = asRecord(record.output);
  return nested ?? record;
}

export function parseGpuObjectOutput(output: unknown): GpuObjectOutput | null {
  const nested = nestedRecord(output);
  if (!nested) {
    return null;
  }
  const objectKey =
    (typeof nested.object_key === "string" && nested.object_key) ||
    (typeof nested.objectKey === "string" && nested.objectKey) ||
    null;
  if (!objectKey) {
    return null;
  }
  const byteSizeRaw = nested.byte_size ?? nested.byteSize ?? nested.size;
  const byteSize = typeof byteSizeRaw === "number" ? byteSizeRaw : Number(byteSizeRaw);
  const etagRaw = nested.etag ?? nested.ETag;
  const uploadIdRaw = nested.upload_id ?? nested.uploadId;
  const partsRaw = nested.parts;
  const parts: { partNumber: number; etag: string }[] = [];
  if (Array.isArray(partsRaw)) {
    for (const part of partsRaw) {
      const item = asRecord(part);
      if (!item) {
        continue;
      }
      const partNumber = Number(item.partNumber ?? item.part_number ?? item.PartNumber);
      const etag = item.etag ?? item.ETag;
      if (Number.isInteger(partNumber) && typeof etag === "string" && etag.length > 0) {
        parts.push({ partNumber, etag });
      }
    }
  }
  return {
    objectKey,
    byteSize: Number.isFinite(byteSize) ? byteSize : 0,
    etag: typeof etagRaw === "string" ? etagRaw : null,
    uploadId: typeof uploadIdRaw === "string" ? uploadIdRaw : null,
    parts: parts.length > 0 ? parts : null,
  };
}

export function gpuOutputLooksLikeBytes(output: unknown): boolean {
  const nested = nestedRecord(output);
  if (!nested) {
    return false;
  }
  const video = nested.video ?? nested.video_base64 ?? nested.data;
  return typeof video === "string" && video.length > 32;
}

export function gpuOutputError(output: unknown): string | null {
  const nested = nestedRecord(output);
  if (!nested || typeof nested.error !== "string" || nested.error.length === 0) {
    return null;
  }
  return nested.error;
}

export function isGpuOom(text: string): boolean {
  return /allocation on device|out of memory|cuda oom|cudnn_status_alloc_failed/i.test(
    text,
  );
}

export function isGpuWebsocketDrop(text: string): boolean {
  return /websocketconnectionclosed|connection to remote host was lost|websocket.*closed/i.test(
    text,
  );
}

function workerErrorText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error_message?: unknown; error?: unknown };
      if (typeof parsed.error_message === "string" && parsed.error_message.length > 0) {
        return parsed.error_message;
      }
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        return parsed.error;
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function gpuFailureMessage(text: string, status?: string): string {
  const extracted = workerErrorText(text);
  if (isGpuOom(extracted)) {
    return "GPU ran out of VRAM during SeedVR2 encoding (Allocation on device). 4K clips stay at 4K on the RTX 4090; retry at source size or a lower scale.";
  }
  if (isGpuWebsocketDrop(extracted)) {
    return "GPU interpolation lost its ComfyUI connection. Retry the job — it stays on the RTX 4090 (CPU fallback is off).";
  }
  if (extracted.length > 0) {
    return extracted;
  }
  return `GPU job ${(status ?? "failed").toLowerCase()}`;
}

function collectGpuErrorText(data: RunpodStatusResponse): string {
  const chunks: string[] = [];
  if (typeof data.error === "string" && data.error.length > 0) {
    chunks.push(data.error);
  }
  const nestedError = gpuOutputError(data.output);
  if (nestedError) {
    chunks.push(nestedError);
  }
  if (typeof data.output === "string" && data.output.length > 0) {
    chunks.push(data.output);
  }
  return chunks.join("\n");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      },
      { once: true },
    );
  });
}

export const GPU_QUEUE_TIMEOUT_MS = 6 * 60 * 1000;
export const GPU_QUEUE_STUCK_MESSAGE =
  "GPU worker stayed queued while pulling the image. Retry the job — it stays on the RTX 4090 (CPU fallback is off).";
