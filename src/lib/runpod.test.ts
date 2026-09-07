import assert from "node:assert/strict";
import test from "node:test";
import { isGpuConfigured, runpodConfig } from "./runpod";

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
  assert.equal(runpodConfig().endpointId, "npjpz24ig6c47j");
  assert.equal(isGpuConfigured(), false);
  if (previousKey) {
    process.env.RUNPOD_API_KEY = previousKey;
  }
  if (previousEndpoint) {
    process.env.RUNPOD_ENDPOINT_ID = previousEndpoint;
  }
});
