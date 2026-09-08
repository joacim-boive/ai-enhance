import { getRequestSession, sessionFromRequest, type Session } from "./session";
import type { Clip, Job } from "./types";

export async function requireSession(): Promise<Session> {
  return getRequestSession();
}

export async function requireOwnedJob(id: string): Promise<Job | null> {
  const session = await getRequestSession();
  const { loadJob } = await import("./jobs");
  const job = await loadJob(id);
  if (!job || job.userId !== session.userId) {
    return null;
  }
  return job;
}

export async function requireOwnedClip(id: string): Promise<Clip | null> {
  const session = await getRequestSession();
  const { loadClip } = await import("./clips");
  const clip = await loadClip(id);
  if (!clip || clip.userId !== session.userId) {
    return null;
  }
  return clip;
}

export function ownedJobFromRequest(request: Request, job: Job | null): Job | null {
  const session = sessionFromRequest(request);
  if (!job || !session || job.userId !== session.userId) {
    return null;
  }
  return job;
}
