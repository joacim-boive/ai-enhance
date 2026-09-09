import type { JobEvent, JobStatus } from "./types";

export function monotonicProgress(current: number, next: number): number {
  if (!Number.isFinite(next) || next < 0) {
    return current;
  }
  const clamped = Math.max(0, Math.min(99, Math.round(next)));
  if (!Number.isFinite(current) || current < 0) {
    return clamped;
  }
  return Math.max(current, clamped);
}

export function upsertLiveProgressEvents(
  events: readonly JobEvent[],
  incoming: JobEvent,
): JobEvent[] {
  if (incoming.level !== "info") {
    return [...events, incoming].slice(-80);
  }
  const last = events[events.length - 1];
  if (last && last.level === "info") {
    return [...events.slice(0, -1), { ...incoming, id: last.id }].slice(-80);
  }
  return [...events, incoming].slice(-80);
}

export function liveProcessingEvent(events: readonly JobEvent[]): JobEvent | null {
  return events[events.length - 1] ?? null;
}

export function mergeIncomingJob<T extends { updatedAt: number; progress: number; status: JobStatus }>(
  current: T,
  incoming: T,
): T {
  if (incoming.updatedAt < current.updatedAt) {
    return current;
  }
  if (incoming.status === "complete" || incoming.status === "failed" || incoming.status === "cancelled") {
    return incoming;
  }
  return {
    ...incoming,
    progress: monotonicProgress(current.progress, incoming.progress),
  };
}
