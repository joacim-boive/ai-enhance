import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put } from "@vercel/blob";
import { blobEnabled } from "./env";
import { uploadRecordKey } from "./keys";
import { DATA_DIR, ensureDirs } from "./paths";
import { getJsonObject, putJsonObject, r2Enabled } from "./r2";
import { SAMPLE_FILE_ID, SAMPLE_STORED_FILE } from "./sample";

export type StoredFile = {
  id: string;
  name: string;
  url: string;
  pathname: string;
  userId?: string;
  objectKey?: string;
};

function localFile(pathname: string): string {
  return path.join(DATA_DIR, pathname);
}

export function localPathFor(pathname: string): string {
  if (pathname.startsWith("public/")) {
    return path.join(/* turbopackIgnore: true */ process.cwd(), pathname);
  }
  return localFile(pathname);
}

export function contentTypeForName(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

export async function saveBytes(
  pathname: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  if (blobEnabled()) {
    const blob = await put(pathname, data, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return blob.url;
  }
  await ensureDirs();
  const full = localFile(pathname);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return `/api/files/${pathname}`;
}

export async function saveFromPath(
  pathname: string,
  filePath: string,
  contentType: string,
): Promise<string> {
  if (blobEnabled()) {
    const blob = await put(pathname, createReadStream(filePath), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      multipart: true,
    });
    return blob.url;
  }
  await ensureDirs();
  const full = localFile(pathname);
  await mkdir(path.dirname(full), { recursive: true });
  if (path.resolve(filePath) !== path.resolve(full)) {
    await copyFile(filePath, full);
  }
  return `/api/files/${pathname}`;
}

export async function saveJson(pathname: string, value: unknown): Promise<string> {
  return saveBytes(pathname, Buffer.from(JSON.stringify(value), "utf8"), "application/json");
}

export async function readBytes(pathname: string): Promise<Buffer | null> {
  if (blobEnabled()) {
    try {
      const result = await get(pathname, { access: "public", useCache: false });
      if (result?.statusCode === 200 && result.stream) {
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      }
    } catch {
      // Fall through to list() for stores that only resolve via prefix.
    }
    const { blobs } = await list({ prefix: pathname, limit: 20 });
    const match = blobs.find((item) => item.pathname === pathname) ?? blobs[0];
    if (!match) {
      return null;
    }
    const response = await fetch(match.url);
    if (!response.ok) {
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return await readFile(localFile(pathname));
  } catch {
    return null;
  }
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  const bytes = await readBytes(pathname);
  if (!bytes) {
    return null;
  }
  return JSON.parse(bytes.toString("utf8")) as T;
}

export async function listPathnames(prefix: string): Promise<string[]> {
  if (blobEnabled()) {
    const { blobs } = await list({ prefix, limit: 100 });
    return blobs.map((item) => item.pathname);
  }
  await ensureDirs();
  const dir = localFile(prefix.replace(/\/$/, ""));
  try {
    const files = await readdir(dir);
    return files.map((file) => `${prefix.replace(/\/$/, "")}/${file}`);
  } catch {
    return [];
  }
}

export async function saveStoredFile(record: StoredFile): Promise<void> {
  if (r2Enabled() && record.userId) {
    await putJsonObject(uploadRecordKey(record.userId, record.id), record);
    return;
  }
  await saveJson(`files/${record.id}.json`, record);
}

export async function loadStoredFile(
  id: string,
  userId?: string,
): Promise<StoredFile | null> {
  if (id === SAMPLE_FILE_ID) {
    return SAMPLE_STORED_FILE;
  }
  if (userId && r2Enabled()) {
    const remote = await getJsonObject<StoredFile>(uploadRecordKey(userId, id));
    if (remote) {
      return remote;
    }
  }
  const local = await readJson<StoredFile>(`files/${id}.json`);
  if (local?.userId && userId && local.userId !== userId) {
    return null;
  }
  return local;
}
