import { loadJob } from "./jobs";
import { getRequestSession, sessionFromRequest, type Session } from "./session";
import type { Job } from "./types";

export async function requireSession(): Promise<Session> {
  return getRequestSession();
}

export async function requireOwnedJob(id: string): Promise<Job | null> {
  const session = await getRequestSession();
  const job = await loadJob(id);
  if (!job || job.userId !== session.userId) {
    return null;
  }
  return job;
}

export function ownedJobFromRequest(request: Request, job: Job | null): Job | null {
  const session = sessionFromRequest(request);
  if (!job || !session || job.userId !== session.userId) {
    return null;
  }
  return job;
}
