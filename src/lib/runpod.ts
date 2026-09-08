import { missingGpuKeyMessage, r2Enabled, runtimeEnv } from "./env";
import {
  gpuHealthKind,
  gpuIssueFromLogLines,
  gpuLiveProgress,
  gpuMissingR2Message,
  gpuOnDemandMessage,
  gpuShouldAlert,
  gpuUnreachableMessage,
  gpuWorkerReadyCount,
  gpuWorkerStatusMessage,
  parseGpuWorkersResponse,
  type GpuQueueWaitUpdate,
  type GpuWorkerPlacement,
  type GpuWorkerSnapshot,
} from "./gpu-health";
import { GPU_QUEUE_HARD_TIMEOUT_MS, shouldExtendGpuQueueWait } from "./job-lifecycle";
import type { HealthStatus } from "./types";

export { gpuShouldAlert };
export type { GpuQueueWaitUpdate };

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
  delayTime?: number;
  executionTime?: number;
  workerId?: string;
};

export async function gpuHealth(): Promise<HealthStatus["gpu"]> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return {
      configured: false,
      endpointId: null,
      ready: false,
      alert: false,
      kind: "unset",
      workers: null,
      message: missingGpuKeyMessage(),
    };
  }
  const r2Ready = r2Enabled();
  if (!r2Ready) {
    return {
      configured: true,
      endpointId,
      ready: false,
      alert: true,
      kind: "missing_r2",
      workers: null,
      message: gpuMissingR2Message(),
    };
  }
  // List workers via REST. Do not GET api.runpod.ai /health — that ping can
  // reset idle timeout and leave a 4090 billed after a job.
  const fetched = await fetchGpuWorkerSnapshot();
  const workers = fetched.snapshot
    ? {
        idle: fetched.snapshot.idle,
        running: fetched.snapshot.running,
        initializing: fetched.snapshot.initializing,
        throttled: fetched.snapshot.throttled,
        unhealthy: fetched.snapshot.unhealthy,
      }
    : null;
  const ready = gpuWorkerReadyCount(workers) > 0;
  const kind = gpuHealthKind({
    configured: true,
    r2Ready: true,
    reachable: fetched.reachable,
    httpOk: fetched.httpOk,
    workers,
  });
  const alert = gpuShouldAlert({
    configured: true,
    r2Ready: true,
    reachable: fetched.reachable,
    httpOk: fetched.httpOk,
    ready,
    throttled: workers?.throttled ?? 0,
    unhealthy: workers?.unhealthy ?? 0,
  });
  let message = gpuOnDemandMessage();
  if (!fetched.reachable || !fetched.httpOk) {
    message = gpuUnreachableMessage();
  } else if (fetched.snapshot) {
    message = gpuWorkerStatusMessage(fetched.snapshot);
  }
  return {
    configured: true,
    endpointId,
    ready,
    alert,
    kind,
    workers,
    message,
  };
}

type GpuWorkerFetchResult = {
  reachable: boolean;
  httpOk: boolean;
  snapshot: GpuWorkerSnapshot | null;
};

const workerLogIssueCache = new Map<string, { at: number; issue: string | null }>();
const WORKER_LOG_CACHE_MS = 45_000;
const WORKER_POLL_MS = 15_000;

async function fetchGpuWorkerSnapshot(): Promise<GpuWorkerFetchResult> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return { reachable: false, httpOk: false, snapshot: null };
  }
  try {
    const response = await fetch(
      `https://api.runpod.io/v2/serverless/${endpointId}/workers?limit=100`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return { reachable: true, httpOk: false, snapshot: null };
    }
    const data: unknown = await response.json();
    return {
      reachable: true,
      httpOk: true,
      snapshot: parseGpuWorkersResponse(data),
    };
  } catch {
    return { reachable: false, httpOk: false, snapshot: null };
  }
}

async function diagnoseGpuWorkers(snapshot: GpuWorkerSnapshot): Promise<GpuWorkerSnapshot> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return snapshot;
  }
  const suspects = snapshot.workers.filter(
    (worker) => worker.status === "THROTTLED" || worker.status === "UNHEALTHY",
  );
  const diagnosed = await Promise.all(
    suspects.slice(0, 2).map(async (worker) => {
      const issue = await peekGpuWorkerIssue(apiKey, endpointId, worker);
      return { id: worker.id, issue };
    }),
  );
  const issues = new Map(diagnosed.map((item) => [item.id, item.issue]));
  return {
    ...snapshot,
    workers: snapshot.workers.map((worker) => ({
      ...worker,
      issue: issues.get(worker.id) ?? worker.issue,
    })),
  };
}

async function peekGpuWorkerIssue(
  apiKey: string,
  endpointId: string,
  worker: GpuWorkerPlacement,
): Promise<string | null> {
  const cached = workerLogIssueCache.get(worker.id);
  const now = Date.now();
  if (cached && now - cached.at < WORKER_LOG_CACHE_MS) {
    return cached.issue;
  }
  const lines = await peekWorkerSystemLogs(apiKey, endpointId, worker.id);
  const issue = gpuIssueFromLogLines(lines);
  workerLogIssueCache.set(worker.id, { at: now, issue });
  return issue;
}

async function peekWorkerSystemLogs(
  apiKey: string,
  endpointId: string,
  workerId: string,
  timeoutMs = 1800,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.runpod.io/v2/serverless/${endpointId}/workers/${encodeURIComponent(workerId)}/logs?source=system&tail=40`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      return [];
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data: unknown = await response.json();
      return jsonLogLines(data);
    }
    return await readSseLogLines(response.body, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function jsonLogLines(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.logs)
      ? record.logs
      : [];
  const lines: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const line = (item as Record<string, unknown>).line;
    if (typeof line === "string" && line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

async function readSseLogLines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines: string[] = [];
  try {
    while (lines.length < 40 && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload) {
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as { line?: unknown };
          if (typeof parsed.line === "string" && parsed.line.length > 0) {
            lines.push(parsed.line);
          }
        } catch {
          lines.push(payload);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return lines;
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
  width?: number;
  height?: number;
  duration?: number;
  resolution: number;
  rotation?: number;
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
    width: input.width,
    height: input.height,
    duration: input.duration,
    rotation: input.rotation ?? 0,
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
  options?: { onWait?: (update: GpuQueueWaitUpdate) => Promise<void> },
): Promise<unknown> {
  if (!runpodConfig().apiKey) {
    throw new Error("GPU is not configured");
  }
  const started = Date.now();
  let lastWorkerCheck = 0;
  let lastSnapshot: GpuWorkerSnapshot | null = null;
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
    if (data.status === "IN_QUEUE" || data.status === "IN_PROGRESS" || !data.status) {
      const elapsedMs = Date.now() - started;
      const now = Date.now();
      if (now - lastWorkerCheck >= WORKER_POLL_MS) {
        lastWorkerCheck = now;
        const fetched = await fetchGpuWorkerSnapshot();
        if (fetched.snapshot) {
          lastSnapshot =
            data.status === "IN_PROGRESS"
              ? fetched.snapshot
              : await diagnoseGpuWorkers(fetched.snapshot);
        }
      }
      if (options?.onWait) {
        await options.onWait(
          gpuLiveProgress({
            runpodStatus: data.status,
            snapshot: lastSnapshot,
            output: data.output,
            delayTimeMs: data.delayTime,
            executionTimeMs: data.executionTime,
            workerId: data.workerId ?? null,
          }),
        );
      }
      if ((data.status === "IN_QUEUE" || !data.status) && elapsedMs > GPU_QUEUE_TIMEOUT_MS) {
        if (!lastSnapshot) {
          const fetched = await fetchGpuWorkerSnapshot();
          lastSnapshot = fetched.snapshot;
        }
        if (
          !shouldExtendGpuQueueWait({
            elapsedMs,
            timeoutMs: GPU_QUEUE_TIMEOUT_MS,
            hardTimeoutMs: GPU_QUEUE_HARD_TIMEOUT_MS,
            workers: lastSnapshot,
          })
        ) {
          const diagnosed = lastSnapshot ? gpuWorkerStatusMessage(lastSnapshot) : null;
          throw new Error(
            diagnosed && diagnosed !== gpuOnDemandMessage()
              ? diagnosed
              : GPU_QUEUE_STUCK_MESSAGE,
          );
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
  return /allocation on device|out of memory|cuda oom|cudnn_status_alloc_failed|triggered memory limits/i.test(
    text,
  );
}

export function isGpuContainerRamOom(text: string): boolean {
  return /triggered memory limits/i.test(text);
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
  if (isGpuContainerRamOom(extracted)) {
    return "GPU worker ran out of RAM interpolating this clip. Retry the job — 24→60 runs RIFE in overlapping chunks so the whole clip is not 5× in memory at once.";
  }
  if (isGpuOom(extracted)) {
    return "GPU ran out of VRAM during SeedVR2 encoding (Allocation on device). 4K clips stay at 4K on the RTX 4090; retry at source size or a lower scale.";
  }
  if (isGpuWebsocketDrop(extracted)) {
    return "GPU interpolation lost its ComfyUI connection. Retry the job — it stays on the RTX 4090 (CPU fallback is off).";
  }
  if (extracted.length > 0) {
    return extracted;
  }
  if (status === "TIMED_OUT") {
    return "GPU job hit the worker time limit. Retry the job — long interpolation clips can take more than a few minutes on the RTX 4090.";
  }
  return `GPU job ${(status ?? "failed").toLowerCase()}`;
}

export type GpuJobFollowKind = "complete" | "fail" | "wait";

export function gpuJobFollowKind(
  status: RunpodStatusResponse["status"],
): GpuJobFollowKind {
  if (status === "COMPLETED") {
    return "complete";
  }
  if (status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT") {
    return "fail";
  }
  return "wait";
}

export function collectGpuErrorText(data: {
  error?: string;
  output?: unknown;
}): string {
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
