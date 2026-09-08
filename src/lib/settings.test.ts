import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  enhanceEngineCopy,
  gpuEngineLabel,
  gpuHubResolution,
  isNoOp,
  outputSizeNotice,
  preferGpuEngine,
  resolveOutputTarget,
  scaleExceeds8k,
  settingsFromPreset,
  treatmentLabel,
  treatmentSlug,
  versionFileName,
  withCustomOverride,
} from "./settings";
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

test("explicit GPU preference always uses the 4090 when configured", () => {
  assert.equal(
    preferGpuEngine({
      enginePreference: "gpu",
      gpuConfigured: true,
      scaleChanged: false,
      fpsChanged: true,
    }),
    true,
  );
});

test("default engine is GPU", () => {
  assert.equal(DEFAULT_SETTINGS.enginePreference, "gpu");
  assert.equal(settingsFromPreset("hfr").enginePreference, "gpu");
});

test("fps-only GPU jobs label as RIFE without SeedVR2", () => {
  assert.equal(
    gpuEngineLabel({ ...DEFAULT_SETTINGS, fps: "60" }),
    "GPU · RIFE 4.9",
  );
  assert.equal(
    enhanceEngineCopy({ fpsChanged: true, scaleChanged: false }),
    "Frame interpolation runs RIFE 4.9 on the RTX 4090. SeedVR2 is skipped.",
  );
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

test("gpu Hub resolution caps 4K 2x at 2160 instead of 8K", () => {
  const uhd: VideoMeta = { ...meta, width: 3840, height: 2160 };
  const target = resolveOutputTarget(uhd, settingsFromPreset("restore"));
  const hub = gpuHubResolution(uhd, target);
  assert.equal(target.height, 4320);
  assert.equal(hub.hubDefault, 4320);
  assert.equal(hub.resolution, 2160);
  assert.equal(hub.capped, true);
});

test("gpu Hub resolution keeps HFR at source short side", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("hfr"));
  const hub = gpuHubResolution(meta, target);
  assert.equal(hub.resolution, 720);
  assert.equal(hub.capped, true);
});

test("gpu Hub resolution sends 2x for 720p restore", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("restore"));
  const hub = gpuHubResolution(meta, target);
  assert.equal(hub.resolution, 1440);
  assert.equal(hub.capped, false);
});

test("4K restore is 8K and warns above UHD", () => {
  const uhd: VideoMeta = { ...meta, width: 3840, height: 2160 };
  const target = resolveOutputTarget(uhd, settingsFromPreset("restore"));
  assert.equal(target.width, 7680);
  assert.equal(target.height, 4320);
  assert.equal(target.cappedAt8k, false);
  assert.equal(target.exceedsUhd, true);
  assert.match(outputSizeNotice(target)?.message ?? "", /Above 4K/);
  assert.equal(scaleExceeds8k(uhd, "2x"), false);
  assert.equal(scaleExceeds8k(uhd, "4x"), true);
});

test("4x of 4K is capped at 8K", () => {
  const uhd: VideoMeta = { ...meta, width: 3840, height: 2160 };
  const target = resolveOutputTarget(uhd, withCustomOverride(settingsFromPreset("restore"), { scale: "4x" }));
  assert.equal(target.width, 7680);
  assert.equal(target.height, 4320);
  assert.equal(target.requestedWidth, 15360);
  assert.equal(target.cappedAt8k, true);
  assert.match(outputSizeNotice(target)?.message ?? "", /Capped at 8K/);
});

test("cinema 4K does not warn", () => {
  const target = resolveOutputTarget(meta, settingsFromPreset("cinema"));
  assert.equal(target.exceedsUhd, false);
  assert.equal(outputSizeNotice(target), null);
});

test("treatment labels describe presets and custom fps runs", () => {
  assert.equal(treatmentLabel(null), "Original");
  assert.equal(treatmentLabel(settingsFromPreset("hfr")), "High Frame Rate");
  assert.equal(treatmentLabel(settingsFromPreset("cinema")), "Cinema 4K");
  const custom = withCustomOverride(settingsFromPreset("restore"), { fps: "120", scale: "none" });
  assert.equal(treatmentLabel(custom), "120 fps · Denoise");
  assert.equal(treatmentSlug(custom), "120fps-denoise");
  assert.equal(versionFileName("sunset.mov", custom), "sunset-120fps-denoise.mov");
});

test("default resolution scale is Source (none)", () => {
  assert.equal(DEFAULT_SETTINGS.scale, "none");
});

test("default settings is source with no denoise or sharpen", () => {
  assert.equal(DEFAULT_SETTINGS.scale, "none");
  assert.equal(DEFAULT_SETTINGS.fps, "keep");
  assert.equal(DEFAULT_SETTINGS.denoise, false);
  assert.equal(DEFAULT_SETTINGS.sharpen, false);
  assert.equal(isNoOp(meta, DEFAULT_SETTINGS), true);
  assert.equal(treatmentLabel(DEFAULT_SETTINGS), "Source");
  assert.equal(treatmentSlug(DEFAULT_SETTINGS), "source");
  assert.equal(versionFileName("sunset.mov", DEFAULT_SETTINGS), "sunset-source.mov");
});
