import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDataCenter,
  gpuBadgeLabel,
  gpuHealthKind,
  gpuIssueFromLogLine,
  gpuLiveProgress,
  gpuQueueWaitUpdate,
  gpuShouldAlert,
  gpuShowsFleetBanner,
  gpuWorkerStatusMessage,
  parseGpuProgressOutput,
  parseGpuWorkersResponse,
} from "./gpu-health";
import type { HealthStatus } from "./types";

const liveFleet = {
  summary: {
    idle: 0,
    initializing: 0,
    running: 1,
    throttled: 2,
    total: 3,
    unhealthy: 0,
  },
  items: [
    {
      dataCenterId: "EUR-NO-1",
      gpuTypeId: "NVIDIA GeForce RTX 4090",
      id: "running-eu",
      image: "registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2",
      status: "RUNNING",
    },
    {
      dataCenterId: "EUR-IS-2",
      id: "throttled-is",
      image: "registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2",
      status: "THROTTLED",
    },
    {
      dataCenterId: "US-IL-1",
      id: "throttled-us",
      image: "registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2",
      status: "THROTTLED",
    },
  ],
};

test("gpuShouldAlert stays quiet when the worker is merely cold or unset", () => {
  assert.equal(
    gpuShouldAlert({
      configured: false,
      r2Ready: false,
      reachable: true,
      httpOk: true,
      ready: false,
      throttled: 0,
    }),
    false,
  );
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      ready: false,
      throttled: 0,
    }),
    false,
  );
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: false,
      httpOk: true,
      ready: false,
      throttled: 0,
    }),
    true,
  );
});

test("gpuShouldAlert fires when every worker is throttled or unhealthy", () => {
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      ready: false,
      throttled: 2,
    }),
    true,
  );
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      ready: true,
      throttled: 2,
    }),
    false,
  );
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      ready: false,
      throttled: 0,
      unhealthy: 1,
    }),
    true,
  );
});

test("parseGpuWorkersResponse reads REST items plus summary", () => {
  const snapshot = parseGpuWorkersResponse(liveFleet);
  assert.equal(snapshot.running, 1);
  assert.equal(snapshot.throttled, 2);
  assert.equal(snapshot.unhealthy, 0);
  assert.equal(snapshot.workers[0]?.dataCenterId, "EUR-NO-1");
});

test("gpu worker copy names regions and Hub pull stalls", () => {
  const snapshot = parseGpuWorkersResponse(liveFleet);
  const message = gpuWorkerStatusMessage(snapshot);
  assert.match(message, /EUR-NO-1 \(Europe\)/);
  assert.match(message, /US-IL-1 \(United States\)/);
  assert.match(message, /EUR-IS-2 \(Europe\)/);
  assert.match(message, /Hub image pull or registry auth/);
  assert.equal(gpuHealthKind({
    configured: true,
    r2Ready: true,
    reachable: true,
    httpOk: true,
    workers: snapshot,
  }), "running");
  assert.equal(gpuBadgeLabel("running"), "GPU busy");
  assert.equal(gpuBadgeLabel("throttled"), "GPU stuck");
  assert.equal(gpuBadgeLabel("warming"), "GPU warming");
});

test("throttled Hub auth logs become a human message", () => {
  assert.match(
    gpuIssueFromLogLine("Failed to get Hub registry auth. Is this a template you have access to?") ?? "",
    /Hub registry auth/,
  );
  assert.match(
    gpuIssueFromLogLine(
      "image pull: registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2: pending",
    ) ?? "",
    /image pull is stuck pending/,
  );
  const snapshot = parseGpuWorkersResponse({
    workers: [
      {
        id: "us",
        status: "THROTTLED",
        dataCenterId: "US-IL-1",
        image: "registry.runpod.net/example:1",
      },
    ],
  });
  snapshot.workers[0].issue =
    gpuIssueFromLogLine("Failed to get Hub registry auth. Is this a template you have access to?");
  const message = gpuWorkerStatusMessage(snapshot);
  assert.match(message, /US-IL-1/);
  assert.match(message, /Hub registry auth failed/);
  assert.equal(
    gpuHealthKind({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      workers: snapshot,
    }),
    "throttled",
  );
  const wait = gpuQueueWaitUpdate(snapshot, "IN_QUEUE");
  assert.equal(wait.level, "warn");
  assert.equal(wait.stage, "Waiting on GPU worker");
  assert.equal(wait.progress, 10);
  assert.equal(wait.runpodStatus, "IN_QUEUE");
  assert.match(wait.message, /has not started on the GPU yet/);
});

test("warming workers stay informational", () => {
  const snapshot = parseGpuWorkersResponse({
    summary: { running: 0, idle: 0, initializing: 1, throttled: 0, unhealthy: 0, total: 1 },
    workers: [{ id: "eu", status: "INITIALIZING", dataCenterId: "EUR-NO-1" }],
  });
  assert.match(gpuWorkerStatusMessage(snapshot), /warming in EUR-NO-1/);
  assert.equal(
    gpuHealthKind({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      workers: snapshot,
    }),
    "warming",
  );
  assert.equal(gpuQueueWaitUpdate(snapshot, "IN_QUEUE").level, "info");
  assert.equal(
    gpuShouldAlert({
      configured: true,
      r2Ready: true,
      reachable: true,
      httpOk: true,
      ready: false,
      throttled: 0,
    }),
    false,
  );
});

test("fleet banner stays off for cold on-demand GPU", () => {
  const gpu: HealthStatus["gpu"] = {
    configured: true,
    endpointId: "tbsk82cmm6azwh",
    ready: false,
    alert: false,
    kind: "on_demand",
    workers: emptyCounts(),
    message: "GPU is on demand. The first enhance job warms an RTX 4090.",
  };
  assert.equal(gpuShowsFleetBanner(gpu), false);
  assert.equal(
    gpuShowsFleetBanner({
      ...gpu,
      kind: "throttled",
      alert: true,
      workers: { idle: 0, running: 0, initializing: 0, throttled: 1, unhealthy: 0 },
      message: "stuck",
    }),
    true,
  );
});

test("formatDataCenter labels known prefixes", () => {
  assert.equal(formatDataCenter("EUR-NO-1"), "EUR-NO-1 (Europe)");
  assert.equal(formatDataCenter("US-IL-1"), "US-IL-1 (United States)");
  assert.equal(formatDataCenter(null), "an unknown region");
});

test("queued jobs stay in the low progress band instead of a fake 88%", () => {
  const queued = gpuLiveProgress({
    runpodStatus: "IN_QUEUE",
    snapshot: parseGpuWorkersResponse(liveFleet),
    delayTimeMs: 120_000,
  });
  assert.equal(queued.runpodStatus, "IN_QUEUE");
  assert.ok(queued.progress < 25);
  assert.match(queued.message, /has not started/);
  assert.match(queued.message, /Queued for 2 min/);
});

test("IN_PROGRESS progress comes from the worker payload, not a timer", () => {
  const parsed = parseGpuProgressOutput({
    percent: 44,
    stage: "SeedVR2",
    detail: "12/30 samples",
  });
  assert.equal(parsed?.percent, 44);
  assert.equal(parsed?.stage, "SeedVR2");
  const live = gpuLiveProgress({
    runpodStatus: "IN_PROGRESS",
    snapshot: parseGpuWorkersResponse(liveFleet),
    output: JSON.stringify({ percent: 44, stage: "SeedVR2", detail: "12/30 samples" }),
    executionTimeMs: 90_000,
    workerId: "running-eu",
  });
  assert.equal(live.progress, 44);
  assert.equal(live.stage, "SeedVR2");
  assert.match(live.message, /EUR-NO-1/);
  assert.match(live.message, /On GPU for 2 min/);
  const unknown = gpuLiveProgress({
    runpodStatus: "IN_PROGRESS",
    snapshot: null,
    executionTimeMs: 0,
  });
  assert.equal(unknown.progress, 30);
  assert.ok(unknown.progress < 88);
});

function emptyCounts() {
  return { idle: 0, running: 0, initializing: 0, throttled: 0, unhealthy: 0 };
}
