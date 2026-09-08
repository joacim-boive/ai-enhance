import assert from "node:assert/strict";
import test from "node:test";
import {
  GPU_QUEUE_HARD_TIMEOUT_MS,
  jobNeedsDispatch,
  jobNeedsGpuFollow,
  shouldExtendGpuQueueWait,
} from "./job-lifecycle";
import type { Job } from "./types";

function job(patch: Partial<Job>): Job {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: "11111111-1111-4111-8111-111111111111",
    name: "clip.mp4",
    status: "queued",
    engine: null,
    settings: {
      preset: "restore",
      scale: "2x",
      fps: "keep",
      denoise: true,
      sharpen: false,
      enginePreference: "auto",
    },
    sourcePath: "users/x/uploads/y.mp4",
    sourceUrl: "/api/media/y/source",
    sourceObjectKey: "users/x/uploads/y.mp4",
    outputPath: null,
    outputUrl: null,
    outputObjectKey: null,
    outputBytes: null,
    outputEtag: null,
    outputMultipartUploadId: null,
    sourceMeta: null,
    outputMeta: null,
    thumbs: [],
    progress: 1,
    stage: "Queued",
    etaSec: null,
    error: null,
    fallbackReason: null,
    events: [],
    runpodJobId: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    startedAt: null,
    ...patch,
  };
}

test("queued jobs without a Runpod id still need dispatch", () => {
  assert.equal(jobNeedsDispatch(job({ status: "queued" })), true);
  assert.equal(jobNeedsGpuFollow(job({ status: "queued" })), false);
});

test("a job already on Runpod is followed, not dispatched again", () => {
  const current = job({
    status: "processing",
    engine: "gpu",
    runpodJobId: "rp-1",
    startedAt: Date.now(),
  });
  assert.equal(jobNeedsDispatch(current), false);
  assert.equal(jobNeedsGpuFollow(current), true);
});

test("stale warming without a Runpod id is retried", () => {
  const stale = job({
    status: "warming",
    engine: "gpu",
    startedAt: Date.now() - 30_000,
  });
  assert.equal(jobNeedsDispatch(stale), true);
  const fresh = job({
    status: "warming",
    engine: "gpu",
    startedAt: Date.now() - 1_000,
  });
  assert.equal(jobNeedsDispatch(fresh), false);
});

test("terminal jobs are left alone", () => {
  assert.equal(jobNeedsDispatch(job({ status: "complete" })), false);
  assert.equal(jobNeedsGpuFollow(job({ status: "failed", runpodJobId: "rp-1" })), false);
});

test("queue wait extends while a worker is initializing", () => {
  assert.equal(
    shouldExtendGpuQueueWait({
      elapsedMs: 7 * 60 * 1000,
      timeoutMs: 6 * 60 * 1000,
      workers: { idle: 0, running: 0, initializing: 1, throttled: 0 },
    }),
    true,
  );
  assert.equal(
    shouldExtendGpuQueueWait({
      elapsedMs: GPU_QUEUE_HARD_TIMEOUT_MS,
      timeoutMs: 6 * 60 * 1000,
      workers: { idle: 0, running: 0, initializing: 1, throttled: 0 },
    }),
    false,
  );
  assert.equal(
    shouldExtendGpuQueueWait({
      elapsedMs: 7 * 60 * 1000,
      timeoutMs: 6 * 60 * 1000,
      workers: { idle: 0, running: 0, initializing: 0, throttled: 0 },
    }),
    false,
  );
});
