import assert from "node:assert/strict";
import test from "node:test";
import { preferGpuEngine, resolveOutputTarget, settingsFromPreset } from "./settings";
import type { VideoMeta } from "./types";

const meta: VideoMeta = {
  width: 1280,
  height: 720,
  fps: 24,
  durationSec: 4,
  videoCodec: "h264",
  audioCodec: "aac",
  sizeBytes: 1_000_000,
  frameCount: 96,
  pixelFormat: "yuv420p",
};

test("restore preset doubles resolution and keeps fps", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("restore"));
  assert.equal(target.width, 2560);
  assert.equal(target.height, 1440);
  assert.equal(target.fps, 24);
  assert.equal(target.scaleChanged, true);
  assert.equal(target.fpsChanged, false);
});

test("hfr preset interpolates to 60 fps at source size", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("hfr"));
  assert.equal(target.width, 1280);
  assert.equal(target.height, 720);
  assert.equal(target.fps, 60);
  assert.equal(target.fpsChanged, true);
});

test("cinema 4k fits 720p into 3840x2160", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("cinema"));
  assert.equal(target.width, 3840);
  assert.equal(target.height, 2160);
});

test("auto uses GPU for fps-only jobs when configured", () => {
  assert.equal(
    preferGpuEngine({
      enginePreference: "auto",
      gpuConfigured: true,
      scaleChanged: false,
      fpsChanged: true,
    }),
    true,
  );
});

test("auto stays on CPU when the GPU key is missing", () => {
  assert.equal(
    preferGpuEngine({
      enginePreference: "auto",
      gpuConfigured: false,
      scaleChanged: true,
      fpsChanged: true,
    }),
    false,
  );
});
