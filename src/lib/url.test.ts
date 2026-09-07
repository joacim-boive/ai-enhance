import assert from "node:assert/strict";
import test from "node:test";
import { isHttpUrl, withDownloadParam } from "./url";

test("detects absolute http(s) urls", () => {
  assert.equal(isHttpUrl("https://blob.vercel-storage.com/a.mp4"), true);
  assert.equal(isHttpUrl("http://localhost:3000/a.mp4"), true);
  assert.equal(isHttpUrl("/api/files/uploads/a.mp4"), false);
});

test("appends download=1 without breaking existing query params", () => {
  assert.equal(withDownloadParam("/api/files/a.mp4"), "/api/files/a.mp4?download=1");
  assert.equal(
    withDownloadParam("https://example.com/a.mp4?foo=1"),
    "https://example.com/a.mp4?foo=1&download=1",
  );
});
