import assert from "node:assert/strict";
import test from "node:test";
import { isActiveJobStatus, isFinishedJobStatus, summarizeJobs } from "./queue-summary";
import type { PublicJob } from "./types";

function mockJob(patch: Partial<PublicJob>): PublicJob {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    name: "test.mp4",
    status: "queued",
    engine: null,
    settings: {
      preset: "cinema",
      scale: "4k",
      fps: "60",
      denoise: false,
      sharpen: false,
      enginePreference: "auto",
    },
    sourceClipId: null,
    outputClipId: null,
    sourceUrl: "/api/media/test/source",
    outputUrl: null,
    outputBytes: null,
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
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    startedAt: null,
    ...patch,
  };
}

test("isActiveJobStatus accurately detects active and inactive statuses", () => {
  assert.equal(isActiveJobStatus("queued"), true);
  assert.equal(isActiveJobStatus("probing"), true);
  assert.equal(isActiveJobStatus("warming"), true);
  assert.equal(isActiveJobStatus("processing"), true);
  assert.equal(isActiveJobStatus("encoding"), true);
  assert.equal(isActiveJobStatus("complete"), false);
  assert.equal(isActiveJobStatus("failed"), false);
  assert.equal(isActiveJobStatus("cancelled"), false);
});

test("isFinishedJobStatus accurately detects finished statuses", () => {
  assert.equal(isFinishedJobStatus("complete"), true);
  assert.equal(isFinishedJobStatus("failed"), true);
  assert.equal(isFinishedJobStatus("cancelled"), true);
  assert.equal(isFinishedJobStatus("queued"), false);
  assert.equal(isFinishedJobStatus("processing"), false);
});

test("summarizeJobs calculates correct counts across diverse job statuses", () => {
  const jobs: PublicJob[] = [
    mockJob({ status: "processing", progress: 45 }),
    mockJob({ status: "queued", progress: 1 }),
    mockJob({ status: "complete", progress: 100 }),
    mockJob({ status: "complete", progress: 100 }),
    mockJob({ status: "failed", error: "FFmpeg error" }),
  ];

  const summary = summarizeJobs(jobs);
  assert.equal(summary.total, 5);
  assert.equal(summary.active, 2);
  assert.equal(summary.queued, 1);
  assert.equal(summary.processing, 1);
  assert.equal(summary.complete, 2);
  assert.equal(summary.failed, 1);
});
