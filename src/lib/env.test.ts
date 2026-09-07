import assert from "node:assert/strict";
import test from "node:test";
import { hostEnvironment, missingGpuKeyMessage, runtimeEnv } from "./env";

test("runtimeEnv reads process.env at call time", () => {
  const key = "LUMEN_TEST_RUNTIME_ENV";
  delete process.env[key];
  assert.equal(runtimeEnv(key), undefined);
  process.env[key] = "  secret-value  ";
  assert.equal(runtimeEnv(key), "secret-value");
  process.env[key] = "   ";
  assert.equal(runtimeEnv(key), undefined);
  delete process.env[key];
});

test("missingGpuKeyMessage names the Vercel environment", () => {
  assert.match(missingGpuKeyMessage("preview"), /Preview/);
  assert.match(missingGpuKeyMessage("production"), /Production/);
  assert.match(missingGpuKeyMessage("local"), /\.env\.local/);
});

test("hostEnvironment maps VERCEL_ENV", () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  assert.equal(hostEnvironment(), "preview");
  process.env.VERCEL_ENV = "production";
  assert.equal(hostEnvironment(), "production");
  delete process.env.VERCEL_ENV;
  assert.equal(hostEnvironment(), "local");
  if (previous) {
    process.env.VERCEL_ENV = previous;
  }
});
