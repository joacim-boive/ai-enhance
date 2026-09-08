import path from "node:path";
import { mediaUploadUrl } from "./keys";
import { extractThumbnails, probeVideo } from "./probe";
import {
  completeMultipartUpload,
  headObject,
  presignGetUrl,
} from "./r2";
import {
  contentTypeForName,
  saveFromPath,
  saveStoredFile,
  type StoredFile,
} from "./storage";
import type { VideoMeta } from "./types";

export type IngestedFile = {
  id: string;
  name: string;
  url: string;
  meta: VideoMeta;
  thumbs: string[];
};

function uploadPathname(id: string, name: string): string {
  const ext = path.extname(name).toLowerCase() || ".mp4";
  return `uploads/${id}${ext}`;
}

export async function ingestLocalVideo(input: {
  id: string;
  name: string;
  localPath: string;
  userId: string;
}): Promise<IngestedFile> {
  const pathname = uploadPathname(input.id, input.name);
  const url = await saveFromPath(
    pathname,
    input.localPath,
    contentTypeForName(input.name),
  );
  return finalizeIngest({
    id: input.id,
    name: input.name,
    url,
    pathname,
    userId: input.userId,
    probeSource: input.localPath,
  });
}

export async function ingestR2Video(input: {
  id: string;
  name: string;
  userId: string;
  objectKey: string;
  uploadId?: string;
  parts?: { partNumber: number; etag: string }[];
}): Promise<IngestedFile> {
  if (input.parts && input.parts.length > 0 && input.uploadId) {
    await completeMultipartUpload({
      objectKey: input.objectKey,
      uploadId: input.uploadId,
      parts: input.parts,
    });
  }
  const head = await headObject(input.objectKey);
  if (!head || !head.contentLength) {
    throw new Error("Upload did not land in private storage.");
  }
  const probeSource = await presignGetUrl(input.objectKey, { expiresIn: 3600 });
  return finalizeIngest({
    id: input.id,
    name: input.name,
    url: mediaUploadUrl(input.id),
    pathname: input.objectKey,
    userId: input.userId,
    objectKey: input.objectKey,
    probeSource,
  });
}

async function finalizeIngest(input: {
  id: string;
  name: string;
  url: string;
  pathname: string;
  userId: string;
  objectKey?: string;
  probeSource: string;
}): Promise<IngestedFile> {
  const meta = await probeVideo(input.probeSource);
  const thumbs = await extractThumbnails(input.probeSource, input.id, 8, meta.durationSec, {
    userId: input.userId,
    kind: "upload",
  });
  const record: StoredFile = {
    id: input.id,
    name: input.name,
    url: input.url,
    pathname: input.pathname,
    userId: input.userId,
    objectKey: input.objectKey,
    meta,
    thumbs,
  };
  await saveStoredFile(record);
  return {
    id: input.id,
    name: input.name,
    url: input.url,
    meta,
    thumbs,
  };
}
