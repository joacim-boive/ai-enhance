import type { JobStatus, PublicJob } from "./types";

export function isActiveJobStatus(status: JobStatus): boolean {
  return ["queued", "probing", "warming", "processing", "encoding"].includes(status);
}

export function isFinishedJobStatus(status: JobStatus): boolean {
  return status === "complete" || status === "failed" || status === "cancelled";
}

export type QueueMetrics = {
  total: number;
  active: number;
  queued: number;
  processing: number;
  complete: number;
  failed: number;
};

export function summarizeJobs(jobs: PublicJob[]): QueueMetrics {
  let active = 0;
  let queued = 0;
  let processing = 0;
  let complete = 0;
  let failed = 0;

  for (const job of jobs) {
    if (job.status === "queued") {
      queued += 1;
      active += 1;
    } else if (
      job.status === "probing" ||
      job.status === "warming" ||
      job.status === "processing" ||
      job.status === "encoding"
    ) {
      processing += 1;
      active += 1;
    } else if (job.status === "complete") {
      complete += 1;
    } else if (job.status === "failed" || job.status === "cancelled") {
      failed += 1;
    }
  }

  return {
    total: jobs.length,
    active,
    queued,
    processing,
    complete,
    failed,
  };
}
