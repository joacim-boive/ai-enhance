import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDescendantIds,
  groupFamilies,
  historyEntries,
  latestVersion,
  removeClipFromFamilies,
  versionCount,
} from "./library-tree";
import { settingsFromPreset } from "./settings";
import type { PublicClip, PublicJob } from "./types";

const root: PublicClip = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "sunset.mp4",
  kind: "original",
  rootClipId: "11111111-1111-4111-8111-111111111111",
  parentClipId: null,
  fileId: "11111111-1111-4111-8111-111111111111",
  jobId: null,
  treatment: null,
  settings: null,
  engine: null,
  url: "/api/media/upload/11111111-1111-4111-8111-111111111111",
  thumbs: [],
  meta: {
    width: 1920,
    height: 1080,
    fps: 24,
    durationSec: 4,
    videoCodec: "h264",
    audioCodec: "aac",
    sizeBytes: 2_000_000,
    frameCount: 96,
    pixelFormat: "yuv420p",
  },
  createdAt: 100,
  updatedAt: 100,
};

const cinema: PublicClip = {
  ...root,
  id: "22222222-2222-4222-8222-222222222222",
  kind: "version",
  parentClipId: root.id,
  jobId: "22222222-2222-4222-8222-222222222222",
  treatment: "Cinema 4K",
  settings: settingsFromPreset("cinema"),
  engine: "gpu",
  url: "/api/media/22222222-2222-4222-8222-222222222222/output",
  createdAt: 200,
  updatedAt: 200,
};

const hfr: PublicClip = {
  ...cinema,
  id: "33333333-3333-4333-8333-333333333333",
  parentClipId: cinema.id,
  jobId: "33333333-3333-4333-8333-333333333333",
  treatment: "High Frame Rate",
  settings: settingsFromPreset("hfr"),
  url: "/api/media/33333333-3333-4333-8333-333333333333/output",
  createdAt: 300,
  updatedAt: 300,
};

const sibling: PublicClip = {
  ...cinema,
  id: "44444444-4444-4444-8444-444444444444",
  parentClipId: root.id,
  jobId: "44444444-4444-4444-8444-444444444444",
  treatment: "High Frame Rate",
  settings: settingsFromPreset("hfr"),
  url: "/api/media/44444444-4444-4444-8444-444444444444/output",
  createdAt: 250,
  updatedAt: 250,
};

test("families group versions under the original upload", () => {
  const families = groupFamilies([hfr, sibling, cinema, root], []);
  assert.equal(families.length, 1);
  assert.equal(families[0]?.root.id, root.id);
  assert.equal(families[0]?.clips.length, 4);
  assert.equal(versionCount(families[0]!), 3);
  assert.equal(latestVersion(families[0]!).id, hfr.id);
});

test("history keeps a tree so 4K can then go to 60 fps", () => {
  const family = groupFamilies([root, cinema, hfr, sibling], [])[0];
  assert.ok(family);
  const entries = historyEntries(family);
  const cinemaNode = entries.find((entry) => entry.id === cinema.id);
  const hfrNode = entries.find((entry) => entry.id === hfr.id);
  const siblingNode = entries.find((entry) => entry.id === sibling.id);
  assert.equal(cinemaNode?.parentId, root.id);
  assert.equal(hfrNode?.parentId, cinema.id);
  assert.equal(siblingNode?.parentId, root.id);
});

test("deleting a version collects only that branch", () => {
  const ids = collectDescendantIds(cinema.id, [root, cinema, hfr, sibling]);
  assert.deepEqual(ids.sort(), [cinema.id, hfr.id].sort());
  const original = collectDescendantIds(root.id, [root, cinema, hfr, sibling]);
  assert.equal(original.length, 4);
});

test("in-progress jobs hang off the source clip", () => {
  const job: PublicJob = {
    id: "55555555-5555-4555-8555-555555555555",
    userId: root.userId,
    name: root.name,
    status: "processing",
    engine: "gpu",
    settings: settingsFromPreset("hfr"),
    sourceClipId: root.id,
    outputClipId: null,
    sourceUrl: "/api/media/job/source",
    outputUrl: null,
    outputBytes: null,
    sourceMeta: root.meta,
    outputMeta: null,
    thumbs: [],
    progress: 40,
    stage: "Enhancing on GPU",
    etaSec: 20,
    error: null,
    fallbackReason: null,
    events: [],
    runpodJobId: null,
    createdAt: 400,
    updatedAt: 400,
    completedAt: null,
    startedAt: 400,
  };
  const family = groupFamilies([root, cinema], [job])[0];
  assert.ok(family);
  const entries = historyEntries(family);
  const pending = entries.find((entry) => entry.id === job.id);
  assert.equal(pending?.kind, "job");
  assert.equal(pending?.parentId, root.id);
  assert.equal(pending?.status, "processing");
});

test("removeClipFromFamilies removes original and its family", () => {
  const families = groupFamilies([root, cinema, hfr], []);
  assert.equal(families.length, 1);
  const updated = removeClipFromFamilies(families, root);
  assert.equal(updated.length, 0);
});

test("removeClipFromFamilies removes version and its descendants optimistically", () => {
  const families = groupFamilies([root, cinema, hfr, sibling], []);
  assert.equal(families[0]?.clips.length, 4);

  // Deleting cinema should also remove hfr (descendant of cinema), but keep root and sibling
  const updated = removeClipFromFamilies(families, cinema);
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.clips.length, 2);
  const remainingIds = updated[0]?.clips.map((c) => c.id).sort();
  assert.deepEqual(remainingIds, [root.id, sibling.id].sort());
});
