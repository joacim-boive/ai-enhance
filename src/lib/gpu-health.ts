import type { GpuHealthKind, HealthStatus, JobEventLevel } from "./types";

export type { GpuHealthKind };

export type GpuWorkerStatus =
  | "RUNNING"
  | "IDLE"
  | "INITIALIZING"
  | "THROTTLED"
  | "UNHEALTHY";

export type GpuWorkerCounts = {
  idle: number;
  running: number;
  initializing: number;
  throttled: number;
  unhealthy: number;
};

export type GpuWorkerPlacement = {
  id: string;
  status: GpuWorkerStatus;
  dataCenterId: string | null;
  gpuTypeId: string | null;
  image: string | null;
  issue: string | null;
};

export type GpuWorkerSnapshot = GpuWorkerCounts & {
  workers: GpuWorkerPlacement[];
};

export type GpuQueueWaitUpdate = {
  message: string;
  level: JobEventLevel;
  stage: string;
  progress: number;
  runpodStatus: "IN_QUEUE" | "IN_PROGRESS" | "unknown";
};

const ON_DEMAND_MESSAGE =
  "GPU is on demand. The first enhance job warms an RTX 4090.";

const HUB_AUTH_MESSAGE =
  "Hub registry auth failed — Runpod could not pull the worker image. Starting a worker in another region (Europe often works) usually clears this.";

const HUB_PULL_MESSAGE =
  "Hub image pull is stuck pending in this region. A worker in another data center, often Europe, usually comes up first.";

const HUB_REGION_HINT =
  "Hub image pull or registry auth can stall in some data centers; a Europe worker often comes up first.";

export function emptyGpuWorkerCounts(): GpuWorkerCounts {
  return { idle: 0, running: 0, initializing: 0, throttled: 0, unhealthy: 0 };
}

export function gpuWorkerReadyCount(workers: GpuWorkerCounts | null): number {
  if (!workers) {
    return 0;
  }
  return workers.idle + workers.running;
}

export function gpuShouldAlert(input: {
  configured: boolean;
  r2Ready: boolean;
  reachable: boolean;
  httpOk: boolean;
  ready: boolean;
  throttled: number;
  unhealthy?: number;
}): boolean {
  if (!input.configured) {
    return false;
  }
  if (!input.r2Ready || !input.reachable || !input.httpOk) {
    return true;
  }
  const blocked = input.throttled > 0 || (input.unhealthy ?? 0) > 0;
  return blocked && !input.ready;
}

export function gpuHealthKind(input: {
  configured: boolean;
  r2Ready: boolean;
  reachable: boolean;
  httpOk: boolean;
  workers: GpuWorkerCounts | null;
}): GpuHealthKind {
  if (!input.configured) {
    return "unset";
  }
  if (!input.r2Ready) {
    return "missing_r2";
  }
  if (!input.reachable || !input.httpOk) {
    return "unreachable";
  }
  const workers = input.workers;
  if (!workers || gpuWorkerTotal(workers) === 0) {
    return "on_demand";
  }
  const ready = gpuWorkerReadyCount(workers);
  if (workers.unhealthy > 0 && ready === 0) {
    return "unhealthy";
  }
  if (workers.throttled > 0 && ready === 0) {
    return "throttled";
  }
  if (workers.initializing > 0 && ready === 0) {
    return "warming";
  }
  if (workers.running > 0) {
    return "running";
  }
  if (workers.idle > 0) {
    return "idle";
  }
  return "on_demand";
}

export function gpuBadgeLabel(kind: GpuHealthKind): string {
  switch (kind) {
    case "unset":
      return "GPU unset";
    case "missing_r2":
    case "unreachable":
      return "GPU issue";
    case "warming":
      return "GPU warming";
    case "idle":
      return "GPU idle";
    case "running":
      return "GPU busy";
    case "throttled":
    case "unhealthy":
      return "GPU stuck";
    default:
      return "GPU set";
  }
}

export function gpuShowsFleetBanner(gpu: HealthStatus["gpu"]): boolean {
  if (!gpu.configured || gpu.kind === "unset" || gpu.kind === "missing_r2") {
    return false;
  }
  if (
    gpu.alert ||
    gpu.kind === "warming" ||
    gpu.kind === "throttled" ||
    gpu.kind === "unhealthy" ||
    gpu.kind === "unreachable"
  ) {
    return true;
  }
  const workers = gpu.workers;
  return Boolean(
    workers &&
      (workers.throttled > 0 || workers.unhealthy > 0 || workers.initializing > 0),
  );
}

export function formatDataCenter(id: string | null): string {
  if (!id) {
    return "an unknown region";
  }
  if (id.startsWith("EUR")) {
    return `${id} (Europe)`;
  }
  if (id.startsWith("US")) {
    return `${id} (United States)`;
  }
  if (id.startsWith("CA")) {
    return `${id} (Canada)`;
  }
  if (id.startsWith("ASIA") || id.startsWith("AP") || id.startsWith("JP")) {
    return `${id} (Asia)`;
  }
  return id;
}

export function isHubRegistryImage(image: string | null): boolean {
  return Boolean(image && image.includes("registry.runpod.net"));
}

export function gpuIssueFromLogLine(line: string): string | null {
  if (/hub registry auth/i.test(line)) {
    return HUB_AUTH_MESSAGE;
  }
  if (/image pull:.*pending/i.test(line)) {
    return HUB_PULL_MESSAGE;
  }
  if (/image pull.*(fail|error|denied)/i.test(line)) {
    return "Hub image pull failed in this region.";
  }
  if (/unauthorized|access denied/i.test(line) && /registry|pull|hub/i.test(line)) {
    return "Container registry denied the image pull.";
  }
  if (/triggered memory limits|container is unhealthy.*oom/i.test(line)) {
    return "GPU worker ran out of RAM interpolating this clip. Long 24→60 jobs stay at RIFE 2× then ffmpeg to 60 so the container does not 5× the whole clip in memory.";
  }
  return null;
}

export function gpuIssueFromLogLines(lines: readonly string[]): string | null {
  for (const line of lines) {
    const issue = gpuIssueFromLogLine(line);
    if (issue) {
      return issue;
    }
  }
  return null;
}

export function parseGpuWorkersResponse(data: unknown): GpuWorkerSnapshot {
  const record = asRecord(data);
  const rawWorkers = record
    ? (Array.isArray(record.workers)
        ? record.workers
        : Array.isArray(record.items)
          ? record.items
          : [])
    : [];
  const workers = rawWorkers
    .map((item) => parseGpuWorker(item))
    .filter((item): item is GpuWorkerPlacement => item !== null);
  const summary = record ? asRecord(record.summary) : null;
  const counted = countGpuWorkers(workers);
  return {
    idle: numberOr(summary?.idle, counted.idle),
    running: numberOr(summary?.running, counted.running),
    initializing: numberOr(summary?.initializing, counted.initializing),
    throttled: numberOr(summary?.throttled, counted.throttled),
    unhealthy: numberOr(summary?.unhealthy, counted.unhealthy),
    workers,
  };
}

export function gpuWorkerStatusMessage(snapshot: GpuWorkerSnapshot | null): string {
  if (!snapshot || snapshot.workers.length === 0) {
    return ON_DEMAND_MESSAGE;
  }
  const running = snapshot.workers.filter((worker) => worker.status === "RUNNING");
  const idle = snapshot.workers.filter((worker) => worker.status === "IDLE");
  const initializing = snapshot.workers.filter((worker) => worker.status === "INITIALIZING");
  const throttled = snapshot.workers.filter((worker) => worker.status === "THROTTLED");
  const unhealthy = snapshot.workers.filter((worker) => worker.status === "UNHEALTHY");
  const parts: string[] = [];

  if (running.length > 0) {
    parts.push(`GPU is busy in ${joinRegions(running)}.`);
  } else if (idle.length > 0) {
    parts.push(`GPU worker is idle in ${joinRegions(idle)}.`);
  } else if (initializing.length > 0) {
    parts.push(
      `GPU worker is warming in ${joinRegions(initializing)}. First boot and image pull can take a few minutes.`,
    );
  }

  if (throttled.length > 0) {
    const diagnosed = uniqueIssues(throttled);
    if (running.length > 0 || idle.length > 0) {
      parts.push(
        `${throttled.length} other worker${throttled.length === 1 ? "" : "s"} throttled in ${joinRegions(throttled)}.`,
      );
    } else if (diagnosed.length === 1) {
      parts.push(`Throttled in ${joinRegions(throttled)}. ${diagnosed[0]}`);
    } else {
      parts.push(
        `GPU workers are throttled in ${joinRegions(throttled)}. Jobs stay queued until a worker becomes ready.`,
      );
    }
    const hint = hubHint(snapshot.workers);
    if (hint && !parts.join(" ").includes("Hub")) {
      parts.push(hint);
    }
  }

  if (unhealthy.length > 0) {
    parts.push(
      `GPU worker in ${joinRegions(unhealthy)} is unhealthy and likely crash-looping. Jobs stay queued until it recovers.`,
    );
  }

  if (parts.length === 0) {
    return ON_DEMAND_MESSAGE;
  }
  return parts.join(" ");
}

export function parseGpuProgressOutput(output: unknown): {
  percent: number;
  stage: string;
  detail: string | null;
} | null {
  if (output == null) {
    return null;
  }
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return parseGpuProgressOutput(JSON.parse(trimmed) as unknown);
      } catch {
        // Fall through to percent-in-text.
      }
    }
    const match = trimmed.match(/(\d{1,3})\s*%/);
    if (match) {
      return {
        percent: clampPercent(Number(match[1])),
        stage: "Enhancing on GPU",
        detail: trimmed.slice(0, 180),
      };
    }
    if (trimmed.length > 0 && trimmed.length < 180) {
      return { percent: 30, stage: "Enhancing on GPU", detail: trimmed };
    }
    return null;
  }
  const record = asRecord(output);
  if (!record) {
    return null;
  }
  const nested = asRecord(record.output) ?? record;
  const percentRaw = nested.percent ?? nested.progress;
  const percent = typeof percentRaw === "number" ? percentRaw : Number(percentRaw);
  const stage =
    (typeof nested.stage === "string" && nested.stage) ||
    (typeof nested.status === "string" && nested.status) ||
    null;
  const detail =
    (typeof nested.detail === "string" && nested.detail) ||
    (typeof nested.message === "string" && nested.message) ||
    null;
  if (Number.isFinite(percent) && percent >= 0) {
    return {
      percent: clampPercent(percent),
      stage: stage ?? "Enhancing on GPU",
      detail,
    };
  }
  if (stage || detail) {
    return { percent: 30, stage: stage ?? "Enhancing on GPU", detail };
  }
  return null;
}

export function gpuQueueWaitUpdate(
  snapshot: GpuWorkerSnapshot | null,
  runpodStatus: string | undefined,
): GpuQueueWaitUpdate {
  const message = gpuWorkerStatusMessage(snapshot);
  const queued = runpodStatus !== "IN_PROGRESS";
  const workers = snapshot;
  const stuck =
    Boolean(workers) &&
    gpuWorkerReadyCount(workers) === 0 &&
    ((workers?.throttled ?? 0) > 0 || (workers?.unhealthy ?? 0) > 0);
  const warming =
    Boolean(workers) &&
    gpuWorkerReadyCount(workers) === 0 &&
    (workers?.initializing ?? 0) > 0;
  if (queued && stuck) {
    return {
      message: `${message} The enhance job has not started on the GPU yet.`,
      level: "warn",
      stage: "Waiting on GPU worker",
      progress: 10,
      runpodStatus: "IN_QUEUE",
    };
  }
  if (queued && warming) {
    return {
      message: `${message} The enhance job is still queued — the worker is not running it yet.`,
      level: "info",
      stage: "Warming GPU",
      progress: 14,
      runpodStatus: "IN_QUEUE",
    };
  }
  if (queued && (workers?.running ?? 0) > 0) {
    return {
      message: `${message} Your job is still queued and has not started.`,
      level: "info",
      stage: "Queued on GPU",
      progress: 16,
      runpodStatus: "IN_QUEUE",
    };
  }
  if (queued) {
    return {
      message: "Queued on Runpod. Waiting for an RTX 4090 worker — the job has not started yet.",
      level: "info",
      stage: "Queued on GPU",
      progress: 12,
      runpodStatus: "IN_QUEUE",
    };
  }
  return {
    message: "Enhancing on the RTX 4090.",
    level: "info",
    stage: "Enhancing on GPU",
    progress: 30,
    runpodStatus: "IN_PROGRESS",
  };
}

export function gpuLiveProgress(input: {
  runpodStatus: string | undefined;
  snapshot: GpuWorkerSnapshot | null;
  output?: unknown;
  delayTimeMs?: number;
  executionTimeMs?: number;
  workerId?: string | null;
}): GpuQueueWaitUpdate {
  const queued = input.runpodStatus !== "IN_PROGRESS";
  if (queued) {
    const update = gpuQueueWaitUpdate(input.snapshot, input.runpodStatus ?? "IN_QUEUE");
    const waited = formatDurationMs(input.delayTimeMs);
    if (!waited) {
      return update;
    }
    return {
      ...update,
      message: `${update.message} Queued for ${waited}.`,
    };
  }
  const parsed = parseGpuProgressOutput(input.output);
  const worker = input.workerId
    ? input.snapshot?.workers.find((item) => item.id === input.workerId)
    : undefined;
  const region = worker ? formatDataCenter(worker.dataCenterId) : null;
  const ran = formatDurationMs(input.executionTimeMs);
  const parts: string[] = [];
  if (region) {
    parts.push(`GPU is running in ${region}.`);
  } else if (input.workerId) {
    parts.push(`GPU worker ${input.workerId} is running.`);
  } else {
    parts.push("GPU worker is running the job.");
  }
  if (parsed?.detail) {
    parts.push(parsed.detail);
  }
  if (ran) {
    parts.push(`On GPU for ${ran}.`);
  }
  const percent =
    parsed?.percent ??
    clampPercent(30 + Math.min(40, Math.floor((input.executionTimeMs ?? 0) / 15000)));
  return {
    message: parts.join(" "),
    level: "info",
    stage: parsed?.stage ?? "Enhancing on GPU",
    progress: percent,
    runpodStatus: "IN_PROGRESS",
  };
}

export function gpuMissingR2Message(): string {
  return "GPU is configured, but Cloudflare R2 is missing. The worker cannot land a private master without a presigned upload.";
}

export function gpuUnreachableMessage(): string {
  return "Could not read Runpod workers. Check RUNPOD_API_KEY and endpoint access — the studio cannot see whether a GPU pod is stuck.";
}

export function gpuOnDemandMessage(): string {
  return ON_DEMAND_MESSAGE;
}

function gpuWorkerTotal(workers: GpuWorkerCounts): number {
  return (
    workers.idle +
    workers.running +
    workers.initializing +
    workers.throttled +
    workers.unhealthy
  );
}

function parseGpuWorker(value: unknown): GpuWorkerPlacement | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  return {
    id: record.id,
    status: normalizeWorkerStatus(record.status),
    dataCenterId: stringOrNull(record.dataCenterId ?? record.data_center_id),
    gpuTypeId: stringOrNull(record.gpuTypeId ?? record.gpu_type_id),
    image: stringOrNull(record.image),
    issue: null,
  };
}

function normalizeWorkerStatus(value: unknown): GpuWorkerStatus {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "RUNNING" || raw === "IDLE" || raw === "INITIALIZING" || raw === "THROTTLED" || raw === "UNHEALTHY") {
    return raw;
  }
  return "INITIALIZING";
}

function countGpuWorkers(workers: GpuWorkerPlacement[]): GpuWorkerCounts {
  const counts = emptyGpuWorkerCounts();
  for (const worker of workers) {
    switch (worker.status) {
      case "RUNNING":
        counts.running += 1;
        break;
      case "IDLE":
        counts.idle += 1;
        break;
      case "THROTTLED":
        counts.throttled += 1;
        break;
      case "UNHEALTHY":
        counts.unhealthy += 1;
        break;
      default:
        counts.initializing += 1;
    }
  }
  return counts;
}

function joinRegions(workers: GpuWorkerPlacement[]): string {
  const regions = [...new Set(workers.map((worker) => formatDataCenter(worker.dataCenterId)))];
  if (regions.length === 0) {
    return "an unknown region";
  }
  if (regions.length === 1) {
    return regions[0];
  }
  if (regions.length === 2) {
    return `${regions[0]} and ${regions[1]}`;
  }
  return `${regions.slice(0, -1).join(", ")}, and ${regions[regions.length - 1]}`;
}

function uniqueIssues(workers: GpuWorkerPlacement[]): string[] {
  return [...new Set(workers.map((worker) => worker.issue).filter((issue): issue is string => Boolean(issue)))];
}

function hubHint(workers: GpuWorkerPlacement[]): string | null {
  if (workers.some((worker) => worker.issue && /hub/i.test(worker.issue))) {
    return null;
  }
  const blocked = workers.filter(
    (worker) => worker.status === "THROTTLED" || worker.status === "INITIALIZING" || worker.status === "UNHEALTHY",
  );
  if (blocked.some((worker) => isHubRegistryImage(worker.image))) {
    return HUB_REGION_HINT;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(99, Math.round(value)));
}

function formatDurationMs(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 1000) {
    return null;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${(minutes / 60).toFixed(1)} h`;
}
