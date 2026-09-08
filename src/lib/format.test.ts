import assert from "node:assert/strict";
import test from "node:test";
import {
  aspectRatioForMeta,
  aspectRatioNumber,
  codedNeedsTranspose,
  compareFrameAspect,
  displaySize,
  formatCodec,
  formatDate,
  mediaFrameStyle,
  normalizeRotation,
  rotationFromProbe,
  transposeFilter,
} from "./format";

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

test("rotation metadata swaps coded 16:9 phone video to display 9:16", () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(rotationFromProbe({ tags: { rotate: "90" } }), 90);
  assert.equal(
    rotationFromProbe({
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
    }),
    90,
  );
  assert.equal(
    rotationFromProbe({
      tags: { rotate: "90" },
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
    }),
    90,
  );
  assert.deepEqual(displaySize(3840, 2160, 90), { width: 2160, height: 3840 });
  assert.deepEqual(displaySize(3840, 2160, 270), { width: 2160, height: 3840 });
  assert.deepEqual(displaySize(3840, 2160, 0), { width: 3840, height: 2160 });
  assert.equal(transposeFilter(90), "transpose=1");
  assert.equal(transposeFilter(270), "transpose=2");
  assert.equal(transposeFilter(0), null);
});

test("native 9:16 reels keep coded size even if a rotate tag is present", () => {
  assert.deepEqual(displaySize(1080, 1920, 0), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize(1080, 1920, 90), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize(2160, 3840, 270), { width: 2160, height: 3840 });
  assert.equal(codedNeedsTranspose(1080, 1920, 90), 0);
  assert.equal(codedNeedsTranspose(3840, 2160, 90), 90);
  assert.equal(compareFrameAspect({ width: 1080, height: 1920 }, "split"), "1080 / 1920");
});

test("compare overlay keeps source aspect and doubles it for side-by-side", () => {
  const portrait = { width: 2160, height: 3840 };
  assert.equal(compareFrameAspect(portrait, "split"), "2160 / 3840");
  assert.equal(compareFrameAspect(portrait, "side-by-side"), "4320 / 3840");
  assert.equal(compareFrameAspect(null, "split"), "16 / 9");
});

test("media frame width is capped by height so 9:16 is not stretched to 16:9", () => {
  const portrait = mediaFrameStyle("2160 / 3840");
  assert.equal(portrait.aspectRatio, "2160 / 3840");
  assert.equal(portrait.maxHeight, "75vh");
  assert.equal(portrait.width, "min(100%, calc(75vh * 0.5625))");
  assert.equal(aspectRatioNumber("16 / 9"), 16 / 9);
});
