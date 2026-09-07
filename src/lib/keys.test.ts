import assert from "node:assert/strict";
import test from "node:test";
import {
  jobOutputKey,
  jobRecordKey,
  ownsObjectKey,
  parseJobIdFromRecordKey,
  uploadObjectKey,
} from "./keys";

const userId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";

test("job output keys are user-scoped", () => {
  assert.equal(jobOutputKey(userId, jobId), `users/${userId}/jobs/${jobId}/output.mp4`);
  assert.equal(jobRecordKey(userId, jobId), `users/${userId}/jobs/${jobId}/job.json`);
  assert.equal(uploadObjectKey(userId, jobId, ".mov"), `users/${userId}/uploads/${jobId}.mov`);
  assert.equal(ownsObjectKey(userId, jobOutputKey(userId, jobId)), true);
  assert.equal(ownsObjectKey(userId, `users/${jobId}/jobs/${jobId}/output.mp4`), false);
  assert.equal(parseJobIdFromRecordKey(jobRecordKey(userId, jobId)), jobId);
});

test("object keys reject traversal and non-uuids", () => {
  assert.throws(() => jobOutputKey("not-a-uuid", jobId));
  assert.equal(ownsObjectKey(userId, `users/${userId}/../secret`), false);
});
