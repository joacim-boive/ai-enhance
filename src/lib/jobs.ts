import { EventEmitter } from "node:events";
import {
  jobPointerKey,
  jobPrefix,
  jobRecordKey,
  parseJobIdFromRecordKey,
} from "./keys";
import { r2Enabled } from "./env";
import { getJsonObject, listObjectKeys, putJsonObject } from "./r2";
import { listPathnames, readJson, saveJson } from "./storage";
import type { Job, JobEvent, JobEventLevel, PublicJob } from "./types";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const cache = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();

export function toPublicJob(job: Job): PublicJob {
  const {
    sourcePath: _sourcePath,
    outputPath: _outputPath,
    sourceObjectKey: _sourceObjectKey,
    outputObjectKey: _outputObjectKey,
    outputEtag: _outputEtag,
    outputMultipartUploadId: _outputMultipartUploadId,
    ...rest
  } = job;
  void _sourcePath;
  void _outputPath;
  void _sourceObjectKey;
  void _outputObjectKey;
  void _outputEtag;
  void _outputMultipartUploadId;
  return rest;
}

async function persist(job: Job): Promise<void> {
  if (r2Enabled()) {
    await putJsonObject(jobRecordKey(job.userId, job.id), job);
    await putJsonObject(jobPointerKey(job.id), { userId: job.userId });
  } else {
    await saveJson(`jobs/${job.id}.json`, job);
  }
  cache.set(job.id, job);
  emitter.emit(job.id, job);
  emitter.emit("all", job);
}

export async function loadJob(id: string): Promise<Job | null> {
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  if (r2Enabled()) {
    const pointer = await getJsonObject<{ userId: string }>(jobPointerKey(id));
    if (!pointer?.userId) {
      return null;
    }
    const stored = await getJsonObject<Job>(jobRecordKey(pointer.userId, id));
    if (stored) {
      cache.set(id, stored);
      return stored;
    }
    return null;
  }
  const stored = await readJson<Job>(`jobs/${id}.json`);
  if (stored) {
    cache.set(id, stored);
    return stored;
  }
  return null;
}

export async function listJobs(userId: string): Promise<Job[]> {
  const jobs: Job[] = [];
  if (r2Enabled()) {
    const keys = await listObjectKeys(jobPrefix(userId));
    for (const key of keys) {
      const id = parseJobIdFromRecordKey(key);
      if (!id) {
        continue;
      }
      const job = await getJsonObject<Job>(key);
      if (job && job.userId === userId) {
        cache.set(job.id, job);
        jobs.push(job);
      }
    }
  } else {
    const pathnames = await listPathnames("jobs/");
    for (const pathname of pathnames) {
      if (!pathname.endsWith(".json") || pathname.endsWith(".tmp")) {
        continue;
      }
      const id = pathname.split("/").pop()?.replace(/\.json$/, "");
      if (!id) {
        continue;
      }
      const job = await loadJob(id);
      if (job && job.userId === userId) {
        jobs.push(job);
      }
    }
  }
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createJob(job: Job): Promise<Job> {
  await persist(job);
  return job;
}

export async function patchJob(
  id: string,
  patch: Partial<Job> | ((current: Job) => Partial<Job>),
): Promise<Job | null> {
  const current = await loadJob(id);
  if (!current) {
    return null;
  }
  const nextPatch = typeof patch === "function" ? patch(current) : patch;
  const next: Job = {
    ...current,
    ...nextPatch,
    updatedAt: Date.now(),
  };
  await persist(next);
  return next;
}

export async function appendEvent(
  id: string,
  event: Omit<JobEvent, "id" | "ts"> & { ts?: number; id?: string },
): Promise<Job | null> {
  const current = await loadJob(id);
  if (!current) {
    return null;
  }
  const nextEvent: JobEvent = {
    id: event.id ?? crypto.randomUUID(),
    ts: event.ts ?? Date.now(),
    stage: event.stage,
    message: event.message,
    progress: event.progress,
    level: event.level,
  };
  const events = [...current.events, nextEvent].slice(-80);
  return patchJob(id, {
    events,
    progress: event.progress,
    stage: event.stage,
  });
}

export function subscribe(
  id: string,
  listener: (job: Job) => void,
): () => void {
  emitter.on(id, listener);
  const timer = setInterval(() => {
    void loadJob(id).then((job) => {
      if (job) {
        listener(job);
      }
    });
  }, 1000);
  return () => {
    emitter.off(id, listener);
    clearInterval(timer);
  };
}

export function getAbortController(id: string): AbortController {
  const existing = abortControllers.get(id);
  if (existing && !existing.signal.aborted) {
    return existing;
  }
  const controller = new AbortController();
  abortControllers.set(id, controller);
  return controller;
}

export function clearAbortController(id: string): void {
  abortControllers.delete(id);
}

export function requestCancel(id: string): boolean {
  const controller = abortControllers.get(id);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

export async function removeJob(id: string): Promise<void> {
  cache.delete(id);
}

export function levelForStatus(status: Job["status"]): JobEventLevel {
  if (status === "failed") {
    return "error";
  }
  if (status === "complete") {
    return "success";
  }
  if (status === "cancelled") {
    return "warn";
  }
  return "info";
}
