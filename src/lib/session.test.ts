import assert from "node:assert/strict";
import test from "node:test";
import { decodeSession, encodeSession, newSession } from "./session";

test("session cookies round-trip and reject tampering", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const session = newSession();
  const token = encodeSession(session, Date.now() + 60_000);
  assert.deepEqual(decodeSession(token), session);
  assert.equal(decodeSession(`${token}x`), null);
  assert.equal(decodeSession("not.a.session"), null);
  const expired = encodeSession(session, Date.now() - 1000);
  assert.equal(decodeSession(expired), null);
});
