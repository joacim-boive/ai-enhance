import assert from "node:assert/strict";
import test from "node:test";
import { aspectRatioForMeta, formatCodec, formatDate } from "./format";

test("formatDate returns a readable stamp", () => {
  assert.equal(formatDate(0), "—");
  const stamp = formatDate(1_757_332_200_000);
  assert.notEqual(stamp, "—");
  assert.match(stamp, /\d{4}/);
});

test("formatCodec pretty-prints common names", () => {
  assert.equal(formatCodec("h264"), "H.264");
  assert.equal(formatCodec("aac"), "AAC");
  assert.equal(formatCodec(null), "—");
  assert.equal(formatCodec("prores"), "prores");
});

test("aspectRatioForMeta preserves ratio and supports custom fallbacks", () => {
  assert.equal(aspectRatioForMeta({ width: 1920, height: 1080 }), "1920 / 1080");
  assert.equal(aspectRatioForMeta({ width: 1080, height: 1080 }), "1080 / 1080");
  assert.equal(aspectRatioForMeta({ width: 1080, height: 1920 }), "1080 / 1920");
  assert.equal(aspectRatioForMeta(null), "16 / 9");
  assert.equal(aspectRatioForMeta(undefined, "4 / 3"), "4 / 3");
  assert.equal(aspectRatioForMeta({ width: 0, height: 0 }), "16 / 9");
});
