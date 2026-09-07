import assert from "node:assert/strict";
import test from "node:test";
import { errorMessageFromUnknown, readJsonResponse } from "./http";

test("readJsonResponse parses a JSON body", async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const data = await readJsonResponse<{ ok: boolean }>(response);
  assert.equal(data.ok, true);
});

test("readJsonResponse rejects an empty error body", async () => {
  const response = new Response("", { status: 500 });
  await assert.rejects(
    () => readJsonResponse(response),
    /empty response/,
  );
});

test("readJsonResponse rejects HTML as JSON", async () => {
  const response = new Response("<html>oops</html>", { status: 500 });
  await assert.rejects(
    () => readJsonResponse(response),
    /Request failed \(500\)/,
  );
});

test("errorMessageFromUnknown uses Error.message", () => {
  assert.equal(errorMessageFromUnknown(new Error("nope"), "fallback"), "nope");
  assert.equal(errorMessageFromUnknown("x", "fallback"), "fallback");
});
