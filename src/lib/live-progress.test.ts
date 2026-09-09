import assert from "node:assert/strict";
import test from "node:test";
import {
  liveProcessingEvent,
  mergeIncomingJob,
  monotonicProgress,
  upsertLiveProgressEvents,
} from "./live-progress";
import type { JobEvent } from "./types";

function event(patch: Partial<JobEvent>): JobEvent {
  return {
    id: "a",
    ts: 1,
    stage: "Enhancing on GPU",
    message: "6/13 samples",
    progress: 52,
    level: "info",
    ...patch,
  };
}

test("monotonicProgress never lets the bar jump backwards", () => {
  assert.equal(monotonicProgress(72, 32), 72);
  assert.equal(monotonicProgress(32, 48), 48);
  assert.equal(monotonicProgress(12, 12), 12);
});

test("info GPU ticks replace the last live card instead of stacking", () => {
  const first = event({ id: "live", message: "2/13 samples", progress: 36 });
  const next = event({
    id: "ignored",
    message: "6/13 samples",
    progress: 52,
    ts: 2,
  });
  const events = upsertLiveProgressEvents([first], next);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.id, "live");
  assert.equal(events[0]?.message, "6/13 samples");
  assert.equal(liveProcessingEvent(events)?.message, "6/13 samples");
});

test("incoming job snapshots cannot rewind progress", () => {
  const current = {
    updatedAt: 20,
    progress: 72,
    status: "processing" as const,
  };
  const stale = mergeIncomingJob(current, {
    updatedAt: 10,
    progress: 30,
    status: "processing",
  });
  assert.equal(stale.progress, 72);
  const reset = mergeIncomingJob(current, {
    updatedAt: 21,
    progress: 32,
    status: "processing",
  });
  assert.equal(reset.progress, 72);
  assert.equal(reset.updatedAt, 21);
});

test("warnings still append so a throttle is not overwritten", () => {
  const live = event({ id: "live" });
  const warn = event({
    id: "warn",
    level: "warn",
    stage: "Waiting on GPU worker",
    message: "throttled",
    progress: 10,
  });
  const events = upsertLiveProgressEvents([live], warn);
  assert.equal(events.length, 2);
  assert.equal(liveProcessingEvent(events)?.id, "warn");
});
