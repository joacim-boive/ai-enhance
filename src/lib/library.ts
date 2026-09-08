import {
  createVersionClipFromJob,
  deleteClipRecord,
  ensureOriginalClip,
  isSampleClip,
  listClips,
  loadClip,
  toPublicClip,
} from "./clips";
import { collectDescendantIds, groupFamilies } from "./library-tree";
import { deleteJob, listJobs, patchJob, requestCancel, toPublicJob } from "./jobs";
import { parseFileIdFromUploadKey } from "./keys";
import { SAMPLE_FILE_ID, SAMPLE_PUBLIC_PATH, SAMPLE_SOURCE_PATH } from "./sample";
import { deleteStoredFile, loadStoredFile, listStoredFiles } from "./storage";
import type { Clip, Job, LibraryFamily } from "./types";

export async function listLibrary(userId: string): Promise<LibraryFamily[]> {
  await hydrateLibrary(userId);
  const clips = await listClips(userId);
  const jobs = await listJobs(userId);
  return groupFamilies(clips.map(toPublicClip), jobs.map(toPublicJob));
}

export async function hydrateLibrary(userId: string): Promise<void> {
  const storedFiles = await listStoredFiles(userId);
  for (const file of storedFiles) {
    await ensureOriginalClip({
      userId,
      fileId: file.id,
      name: file.name,
      url: file.url,
      pathname: file.pathname,
      objectKey: file.objectKey ?? null,
    });
  }

  const jobs = await listJobs(userId);
  for (const job of jobs) {
    const parent = await resolveSourceClip(job);
    if (job.sourceClipId !== parent.id) {
      await patchJob(job.id, { sourceClipId: parent.id });
    }
    const reusedSource =
      Boolean(job.outputObjectKey) &&
      Boolean(job.sourceObjectKey) &&
      job.outputObjectKey === job.sourceObjectKey;
    if (job.status === "complete" && job.outputUrl && !job.outputClipId && !reusedSource) {
      const version = await createVersionClipFromJob({ ...job, sourceClipId: parent.id }, parent);
      if (job.outputClipId !== version.id) {
        await patchJob(job.id, { outputClipId: version.id });
      }
    }
  }
}

async function resolveSourceClip(job: Job): Promise<Clip> {
  if (job.sourceClipId) {
    const existing = await loadClip(job.sourceClipId);
    if (existing) {
      return existing;
    }
  }

  const fileId =
    parseFileIdFromUploadKey(job.sourceObjectKey ?? "") ??
    parseFileIdFromUploadKey(job.sourcePath) ??
    (isSampleSource(job) ? SAMPLE_FILE_ID : null);

  if (fileId === SAMPLE_FILE_ID) {
    return ensureOriginalClip({
      userId: job.userId,
      fileId: SAMPLE_FILE_ID,
      name: job.name,
      url: SAMPLE_PUBLIC_PATH,
      pathname: SAMPLE_SOURCE_PATH,
      objectKey: null,
      thumbs: job.thumbs,
      meta: job.sourceMeta,
    });
  }

  if (fileId) {
    const stored = await loadStoredFile(fileId, job.userId);
    return ensureOriginalClip({
      userId: job.userId,
      fileId,
      name: stored?.name ?? job.name,
      url: stored?.url ?? job.sourceUrl,
      pathname: stored?.pathname ?? job.sourcePath,
      objectKey: stored?.objectKey ?? job.sourceObjectKey,
      thumbs: job.thumbs,
      meta: job.sourceMeta,
    });
  }

  return ensureOriginalClip({
    userId: job.userId,
    fileId: crypto.randomUUID(),
    name: job.name,
    url: job.sourceUrl,
    pathname: job.sourcePath,
    objectKey: job.sourceObjectKey,
    thumbs: job.thumbs,
    meta: job.sourceMeta,
  });
}

function isSampleSource(job: Job): boolean {
  return (
    job.sourcePath === SAMPLE_SOURCE_PATH ||
    job.sourcePath.includes("sample-24fps") ||
    job.sourceUrl.includes("sample-24fps")
  );
}

export async function deleteClipCascade(clipId: string, userId: string): Promise<boolean> {
  const clip = await loadClip(clipId);
  if (!clip || clip.userId !== userId) {
    return false;
  }
  const clips = await listClips(userId);
  const jobs = await listJobs(userId);
  const ids = new Set(collectDescendantIds(clipId, clips));
  const doomed = clips.filter((item) => ids.has(item.id));

  for (const job of jobs) {
    const related =
      (job.sourceClipId && ids.has(job.sourceClipId)) ||
      (job.outputClipId && ids.has(job.outputClipId)) ||
      (job.id && ids.has(job.id));
    if (!related) {
      continue;
    }
    requestCancel(job.id);
    await deleteJob(job.id);
  }

  for (const item of doomed) {
    await deleteClipRecord(item.id, userId);
  }

  if (clip.kind === "original" && clip.fileId && !isSampleClip(clip)) {
    await deleteStoredFile(clip.fileId, userId);
  }

  return true;
}
