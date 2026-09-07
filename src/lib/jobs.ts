import { EventEmitter } from "node:events";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { ensureDirs, JOBS_DIR, jobFile } from "./paths";
import type { Job, JobEvent, JobEventLevel, PublicJob } from "./types";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const cache = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();

export function toPublicJob(job: Job): PublicJob {
  const { sourcePath: _sourcePath, outputPath: _outputPath, ...rest } = job;
  void _sourcePath;
  void _outputPath;
  return rest;
}

async function persist(job: Job): Promise<void> {
  await ensureDirs();
  const tmp = `${jobFile(job.id)}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2), "utf8");
  await rename(tmp, jobFile(job.id));
  cache.set(job.id, job);
  emitter.emit(job.id, job);
  emitter.emit("all", job);
}

export async function loadJob(id: string): Promise<Job | null> {
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  try {
    const raw = await readFile(jobFile(id), "utf8");
    const job = JSON.parse(raw) as Job;
    cache.set(id, job);
    return job;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<Job[]> {
  await ensureDirs();
  const files = await readdir(JOBS_DIR);
  const jobs: Job[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) {
      continue;
    }
    const id = file.replace(/\.json$/, "");
    const job = await loadJob(id);
    if (job) {
      jobs.push(job);
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
  return () => emitter.off(id, listener);
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
  try {
    await unlink(jobFile(id));
  } catch {
    // already gone
  }
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
