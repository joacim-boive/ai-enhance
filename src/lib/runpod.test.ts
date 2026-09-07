import assert from "node:assert/strict";
import test from "node:test";
import {
  gpuFailureMessage,
  gpuOutputLooksLikeBytes,
  isGpuConfigured,
  isGpuOom,
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
  assert.match(
    gpuFailureMessage("torch.OutOfMemoryError: Allocation on device"),
    /VRAM/,
  );
  assert.equal(gpuFailureMessage("", "FAILED"), "GPU job failed");
});
