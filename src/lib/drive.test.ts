import assert from "node:assert/strict";
import test from "node:test";
import {
  filenameFromContentDisposition,
  isGoogleDriveUrl,
  parseGoogleDriveFileId,
} from "./drive";

test("parses Google Drive share links and raw ids", () => {
  const id = "1AbCdefGhIjkLmNoPqRsTuVwXyZ012345";
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`),
    id,
  );
  assert.equal(parseGoogleDriveFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com/uc?export=download&id=${id}`),
    id,
  );
  assert.equal(
    parseGoogleDriveFileId(`https://drive.usercontent.google.com/download?id=${id}&export=download`),
    id,
  );
  assert.equal(parseGoogleDriveFileId(id), id);
});

test("rejects folders and non-Drive urls", () => {
  assert.equal(
    parseGoogleDriveFileId("https://drive.google.com/drive/folders/1AbCdefGhIjkLmNoPqRsTuVwXyZ012345"),
    null,
  );
  assert.equal(parseGoogleDriveFileId("https://dropbox.com/s/abc/clip.mp4"), null);
  assert.equal(parseGoogleDriveFileId("not a url"), null);
  assert.equal(isGoogleDriveUrl("https://drive.google.com/file/d/1AbCdefGhIjkLmNoPqRsTuVwXyZ012345/view"), true);
});

test("reads a filename from Content-Disposition", () => {
  assert.equal(filenameFromContentDisposition(null, "fallback.mp4"), "fallback.mp4");
  assert.equal(
    filenameFromContentDisposition('attachment; filename="master.mov"', "fallback.mp4"),
    "master.mov",
  );
  assert.equal(
    filenameFromContentDisposition("attachment; filename*=UTF-8''clip%20take%202.mp4", "fallback.mp4"),
    "clip take 2.mp4",
  );
});
