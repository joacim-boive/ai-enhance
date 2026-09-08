import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoFilters, ffmpegArgs } from "./ffmpeg-graph";
import { parseProgressLine } from "./ffmpeg";

test("high-quality graph includes lanczos and motion interpolation", () => {
  const graph = buildVideoFilters({
    width: 2560,
    height: 1440,
    fps: 60,
    scaleChanged: true,
    fpsChanged: true,
    denoise: true,
    sharpen: true,
    quality: "high",
  });
  assert.match(graph, /hqdn3d/);
  assert.match(graph, /lanczos/);
  assert.match(graph, /minterpolate=fps=60:mi_mode=mci/);
  assert.match(graph, /unsharp/);
});

test("fast fallback uses blend interpolation", () => {
  const graph = buildVideoFilters({
    width: 1280,
    height: 720,
    fps: 60,
    scaleChanged: false,
    fpsChanged: true,
    denoise: false,
    sharpen: false,
    quality: "fast",
  });
  assert.equal(graph, "minterpolate=fps=60:mi_mode=blend");
});

test("rotated sources bake transpose before other filters", () => {
  const graph = buildVideoFilters({
    width: 2160,
    height: 3840,
    fps: 48,
    scaleChanged: false,
    fpsChanged: true,
    denoise: false,
    sharpen: false,
    quality: "fast",
    rotation: 90,
  });
  assert.equal(graph, "transpose=1,minterpolate=fps=48:mi_mode=blend");
});

test("ffmpeg args enable http reconnect for remote inputs", () => {
  const args = ffmpegArgs({
    inputPath: "https://blob.example/video.mp4",
    outputPath: "out.mp4",
    filters: "",
    hasAudio: false,
  });
  assert.ok(args.includes("-protocol_whitelist"));
  assert.ok(args.includes("-reconnect"));
  assert.ok(args.includes("-noautorotate"));
  assert.ok(args.indexOf("-noautorotate") < args.indexOf("-i"));
});

test("ffmpeg args map audio when present", () => {
  const args = ffmpegArgs({
    inputPath: "in.mp4",
    outputPath: "out.mp4",
    filters: "scale=1920:1080",
    hasAudio: true,
  });
  assert.ok(args.includes("0:a:0?"));
  assert.ok(args.includes("pipe:1"));
});

test("parses ffmpeg out_time_ms progress", () => {
  const parsed = parseProgressLine("out_time_ms=2000000\nprogress=continue\n", 4);
  assert.ok(parsed);
  assert.equal(parsed.outTimeSec, 2);
  assert.equal(parsed.ratio, 0.5);
});
