import { clipPointerKey, clipPrefix, clipRecordKey, isUuid, parseClipIdFromRecordKey } from "./keys";
import { r2Enabled } from "./env";
import { deleteObject, getJsonObject, listObjectKeys, putJsonObject } from "./r2";
import { SAMPLE_FILE_ID } from "./sample";
import { treatmentLabel } from "./settings";
import { deleteLocalPathname, listPathnames, readJson, saveJson } from "./storage";
import type { Clip, Job, PublicClip, VideoMeta } from "./types";

const cache = new Map<string, Clip>();

export function toPublicClip(clip: Clip): PublicClip {
  const { pathname: _pathname, objectKey: _objectKey, ...rest } = clip;
  void _pathname;
  void _objectKey;
  return rest;
}

async function persist(clip: Clip): Promise<void> {
  if (r2Enabled()) {
    await putJsonObject(clipRecordKey(clip.userId, clip.id), clip);
    await putJsonObject(clipPointerKey(clip.id), { userId: clip.userId });
  } else {
    await saveJson(`clips/${clip.id}.json`, clip);
  }
  cache.set(clip.id, clip);
}

export async function loadClip(id: string): Promise<Clip | null> {
  if (!isUuid(id)) {
    return null;
  }
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  if (r2Enabled()) {
    const pointer = await getJsonObject<{ userId: string }>(clipPointerKey(id));
    if (!pointer?.userId) {
      return null;
    }
    const stored = await getJsonObject<Clip>(clipRecordKey(pointer.userId, id));
    if (stored) {
      cache.set(id, stored);
      return stored;
    }
    return null;
  }
  const stored = await readJson<Clip>(`clips/${id}.json`);
  if (stored) {
    cache.set(id, stored);
    return stored;
  }
  return null;
}

export async function listClips(userId: string): Promise<Clip[]> {
  const clips: Clip[] = [];
  if (r2Enabled()) {
    const keys = await listObjectKeys(clipPrefix(userId));
    for (const key of keys) {
      const id = parseClipIdFromRecordKey(key);
      if (!id) {
        continue;
      }
      const clip = await getJsonObject<Clip>(key);
      if (clip && clip.userId === userId) {
        cache.set(clip.id, clip);
        clips.push(clip);
      }
    }
  } else {
    const pathnames = await listPathnames("clips/");
    for (const pathname of pathnames) {
      if (!pathname.endsWith(".json") || pathname.endsWith(".tmp")) {
        continue;
      }
      const id = pathname.split("/").pop()?.replace(/\.json$/, "");
      if (!id) {
        continue;
      }
      const clip = await loadClip(id);
      if (clip && clip.userId === userId) {
        clips.push(clip);
      }
    }
  }
  return clips.sort((a, b) => b.createdAt - a.createdAt);
}

export async function findClipByFileId(userId: string, fileId: string): Promise<Clip | null> {
  const clips = await listClips(userId);
  return (
    clips.find((clip) => clip.kind === "original" && clip.fileId === fileId) ??
    clips.find((clip) => clip.id === fileId) ??
    null
  );
}

export async function saveClip(clip: Clip): Promise<Clip> {
  await persist(clip);
  return clip;
}

export async function ensureClip(clip: Clip): Promise<Clip> {
  const existing = await loadClip(clip.id);
  if (!existing) {
    return saveClip(clip);
  }
  const next: Clip = {
    ...existing,
    name: existing.name || clip.name,
    thumbs: existing.thumbs.length > 0 ? existing.thumbs : clip.thumbs,
    meta: existing.meta ?? clip.meta,
    url: existing.url || clip.url,
    pathname: existing.pathname || clip.pathname,
    objectKey: existing.objectKey ?? clip.objectKey,
    treatment: existing.treatment ?? clip.treatment,
    settings: existing.settings ?? clip.settings,
    engine: existing.engine ?? clip.engine,
    updatedAt: Date.now(),
  };
  if (
    next.meta === existing.meta &&
    next.thumbs === existing.thumbs &&
    next.url === existing.url
  ) {
    return existing;
  }
  return saveClip(next);
}

export async function ensureOriginalClip(input: {
  userId: string;
  fileId: string;
  name: string;
  url: string;
  pathname: string;
  objectKey: string | null;
  thumbs?: string[];
  meta?: VideoMeta | null;
}): Promise<Clip> {
  const existing = isUuid(input.fileId)
    ? ((await loadClip(input.fileId)) ?? (await findClipByFileId(input.userId, input.fileId)))
    : await findClipByFileId(input.userId, input.fileId);
  if (existing) {
    return ensureClip({
      ...existing,
      name: existing.name || input.name,
      url: existing.url || input.url,
      pathname: existing.pathname || input.pathname,
      objectKey: existing.objectKey ?? input.objectKey,
      thumbs: existing.thumbs.length > 0 ? existing.thumbs : (input.thumbs ?? []),
      meta: existing.meta ?? input.meta ?? null,
    });
  }
  const now = Date.now();
  const id = isUuid(input.fileId) ? input.fileId : crypto.randomUUID();
  return saveClip({
    id,
    userId: input.userId,
    name: input.name,
    kind: "original",
    rootClipId: id,
    parentClipId: null,
    fileId: input.fileId,
    jobId: null,
    treatment: null,
    settings: null,
    engine: null,
    pathname: input.pathname,
    url: input.url,
    objectKey: input.objectKey,
    thumbs: input.thumbs ?? [],
    meta: input.meta ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function createVersionClipFromJob(job: Job, parent: Clip): Promise<Clip> {
  const now = Date.now();
  return ensureClip({
    id: job.id,
    userId: job.userId,
    name: job.name,
    kind: "version",
    rootClipId: parent.rootClipId,
    parentClipId: parent.id,
    fileId: parent.fileId,
    jobId: job.id,
    treatment: treatmentLabel(job.settings),
    settings: job.settings,
    engine: job.engine,
    pathname: job.outputPath ?? job.outputObjectKey ?? parent.pathname,
    url: job.outputUrl ?? parent.url,
    objectKey: job.outputObjectKey,
    thumbs: job.thumbs,
    meta: job.outputMeta,
    createdAt: job.completedAt ?? now,
    updatedAt: now,
  });
}

export async function deleteClipRecord(id: string, userId: string): Promise<void> {
  cache.delete(id);
  if (r2Enabled()) {
    await deleteObject(clipRecordKey(userId, id)).catch(() => undefined);
    await deleteObject(clipPointerKey(id)).catch(() => undefined);
    return;
  }
  await deleteLocalPathname(`clips/${id}.json`);
}

export function isSampleClip(clip: Clip | PublicClip): boolean {
  return clip.fileId === SAMPLE_FILE_ID;
}
