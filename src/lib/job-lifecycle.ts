import type { Job, JobStatus } from "./types";

export const JOB_DISPATCH_STALE_MS = 20_000;
export const GPU_QUEUE_HARD_TIMEOUT_MS = 20 * 60 * 1000;

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "complete" || status === "failed" || status === "cancelled";
}

export function jobNeedsDispatch(job: Job, now = Date.now()): boolean {
  if (isTerminalJobStatus(job.status)) {
    return false;
  }
  if (job.runpodJobId) {
    return false;
  }
  if (job.status === "queued") {
    return true;
  }
  if (!job.startedAt) {
    return true;
  }
  return now - job.startedAt >= JOB_DISPATCH_STALE_MS;
}

export function jobNeedsGpuFollow(job: Job): boolean {
  return Boolean(job.runpodJobId) && !isTerminalJobStatus(job.status);
}

export function shouldExtendGpuQueueWait(input: {
  elapsedMs: number;
  timeoutMs: number;
  hardTimeoutMs?: number;
  workers: {
    idle: number;
    running: number;
    initializing: number;
    throttled: number;
    unhealthy?: number;
  } | null;
}): boolean {
  if (input.elapsedMs < input.timeoutMs) {
    return true;
  }
  const hardTimeout = input.hardTimeoutMs ?? GPU_QUEUE_HARD_TIMEOUT_MS;
  if (input.elapsedMs >= hardTimeout) {
    return false;
  }
  const workers = input.workers;
  if (!workers) {
    return false;
  }
  return (
    workers.initializing > 0 ||
    workers.throttled > 0 ||
    workers.running > 0 ||
    (workers.unhealthy ?? 0) > 0
  );
}
