import assert from "node:assert/strict";
import test from "node:test";
import {
  GPU_QUEUE_STUCK_MESSAGE,
  gpuFailureMessage,
  gpuJobFollowKind,
  gpuOutputLooksLikeBytes,
  gpuShouldAlert,
  gpuSkipUpscale,
  gpuTaskType,
  gpuWarmupMessage,
  isGpuConfigured,
  isGpuOom,
  isGpuWebsocketDrop,
  parseGpuObjectOutput,
  runpodConfig,
} from "./runpod";

test("runpodConfig reads RUNPOD_API_KEY at call time", () => {
  const previousKey = process.env.RUNPOD_API_KEY;
  const previousEndpoint = process.env.RUNPOD_ENDPOINT_ID;
  process.env.RUNPOD_API_KEY = " rp_test_key ";
  process.env.RUNPOD_ENDPOINT_ID = " custom-endpoint ";
  assert.equal(runpodConfig().apiKey, "rp_test_key");
  assert.equal(runpodConfig().endpointId, "custom-endpoint");
  assert.equal(isGpuConfigured(), true);
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_ENDPOINT_ID;
  assert.equal(runpodConfig().apiKey, null);
  assert.equal(runpodConfig().endpointId, "tbsk82cmm6azwh");
  process.env.RUNPOD_ENDPOINT_ID = "npjpz24ig6c47j";
  assert.equal(runpodConfig().endpointId, "tbsk82cmm6azwh");
  assert.equal(isGpuConfigured(), false);
  if (previousKey) {
    process.env.RUNPOD_API_KEY = previousKey;
  }
  delete process.env.RUNPOD_ENDPOINT_ID;
  if (previousEndpoint) {
    process.env.RUNPOD_ENDPOINT_ID = previousEndpoint;
  }
});

test("parseGpuObjectOutput reads object_key and never requires inline bytes", () => {
  const parsed = parseGpuObjectOutput({
    object_key: "users/11111111-1111-4111-8111-111111111111/jobs/22222222-2222-4222-8222-222222222222/output.mp4",
    byte_size: 2048,
    etag: "abc",
  });
  assert.equal(parsed?.byteSize, 2048);
  assert.equal(parsed?.etag, "abc");
  assert.equal(parsed?.objectKey.endsWith("/output.mp4"), true);
  assert.equal(parseGpuObjectOutput({ video_path: "/ComfyUI/output/x.mp4" }), null);
  assert.equal(gpuOutputLooksLikeBytes({ video: "a".repeat(40) }), true);
  assert.equal(gpuOutputLooksLikeBytes({ object_key: "users/x/jobs/y/output.mp4" }), false);
});

test("gpuFailureMessage rewrites SeedVR2 device allocation OOMs", () => {
  assert.equal(isGpuOom("Error in Phase 1 (Encoding): Allocation on device"), true);
  assert.equal(isGpuOom("WARN: container is unhealthy: triggered memory limits (OOM)"), true);
  assert.match(
    gpuFailureMessage("WARN: container is unhealthy: triggered memory limits (OOM)"),
    /RAM interpolating/,
  );
  assert.match(
    gpuFailureMessage("torch.OutOfMemoryError: Allocation on device"),
    /VRAM/,
  );
  assert.equal(gpuFailureMessage("", "FAILED"), "GPU job failed");
  assert.match(gpuFailureMessage("", "TIMED_OUT"), /time limit/i);
});

test("queue timeout message does not mention CPU fallback", () => {
  assert.match(GPU_QUEUE_STUCK_MESSAGE, /RTX 4090/);
  assert.doesNotMatch(GPU_QUEUE_STUCK_MESSAGE, /Falling back to CPU/i);
});

test("gpuFailureMessage extracts websocket drops and does not mention CPU fallback", () => {
  const raw = JSON.stringify({
    error_type: "<class 'websocket._exceptions.WebSocketConnectionClosedException'>",
    error_message: "Connection to remote host was lost.",
  });
  assert.equal(isGpuWebsocketDrop(raw), true);
  const message = gpuFailureMessage(raw);
  assert.match(message, /RTX 4090/);
  assert.doesNotMatch(message, /CPU interpolation/i);
});

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

test("fps-only GPU jobs skip SeedVR2 and still request interpolation", () => {
  assert.equal(gpuTaskType(false, true), "upscale_and_interpolation");
  assert.equal(gpuSkipUpscale(false, true), true);
  assert.equal(gpuTaskType(true, false), "upscale");
  assert.equal(gpuSkipUpscale(true, false), false);
  assert.equal(gpuSkipUpscale(true, true), false);
  assert.match(gpuWarmupMessage({
    scaleChanged: false,
    fpsChanged: true,
    hubCapped: true,
    hubResolution: 2160,
    hubDefault: 4320,
  }), /RIFE interpolation only/);
});

test("GPU follow completes finished jobs and fails timed-out ones", () => {
  assert.equal(gpuJobFollowKind("COMPLETED"), "complete");
  assert.equal(gpuJobFollowKind("IN_PROGRESS"), "wait");
  assert.equal(gpuJobFollowKind("IN_QUEUE"), "wait");
  assert.equal(gpuJobFollowKind("TIMED_OUT"), "fail");
  assert.equal(gpuJobFollowKind("FAILED"), "fail");
});
