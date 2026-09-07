import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractThumbnails, probeVideo } from "./probe";
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
    probeSource: input.localPath,
  });
}

export async function ingestRemoteVideo(input: {
  id: string;
  name: string;
  url: string;
  pathname: string;
}): Promise<IngestedFile> {
  return finalizeIngest({
    id: input.id,
    name: input.name,
    url: input.url,
    pathname: input.pathname,
    probeSource: input.url,
  });
}

async function finalizeIngest(input: {
  id: string;
  name: string;
  url: string;
  pathname: string;
  probeSource: string;
}): Promise<IngestedFile> {
  const meta = await probeVideo(input.probeSource);
  const thumbs = await extractThumbnails(input.probeSource, input.id, 8, meta.durationSec);
  const record: StoredFile = {
    id: input.id,
    name: input.name,
    url: input.url,
    pathname: input.pathname,
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

export async function writeTempFile(name: string, data: Buffer): Promise<string> {
  const dest = path.join(os.tmpdir(), name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, data);
  return dest;
}
