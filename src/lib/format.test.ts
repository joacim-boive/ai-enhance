import assert from "node:assert/strict";
import test from "node:test";
import { formatCodec, formatDate } from "./format";

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
