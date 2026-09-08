const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function assertSafeId(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function uploadObjectKey(userId: string, fileId: string, ext: string): string {
  const suffix = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `users/${assertSafeId(userId, "user")}/uploads/${assertSafeId(fileId, "file")}${suffix || ".mp4"}`;
}

export function uploadRecordKey(userId: string, fileId: string): string {
  return `users/${assertSafeId(userId, "user")}/uploads/${assertSafeId(fileId, "file")}.json`;
}

export function uploadThumbKey(userId: string, fileId: string, name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("Invalid thumb name");
  }
  return `users/${assertSafeId(userId, "user")}/uploads/${assertSafeId(fileId, "file")}/thumbs/${name}`;
}

export function jobRecordKey(userId: string, jobId: string): string {
  return `users/${assertSafeId(userId, "user")}/jobs/${assertSafeId(jobId, "job")}/job.json`;
}

export function jobOutputKey(userId: string, jobId: string): string {
  return `users/${assertSafeId(userId, "user")}/jobs/${assertSafeId(jobId, "job")}/output.mp4`;
}

export function jobThumbKey(userId: string, jobId: string, name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("Invalid thumb name");
  }
  return `users/${assertSafeId(userId, "user")}/jobs/${assertSafeId(jobId, "job")}/thumbs/${name}`;
}

export function jobPrefix(userId: string): string {
  return `users/${assertSafeId(userId, "user")}/jobs/`;
}

export function jobObjectsPrefix(userId: string, jobId: string): string {
  return `users/${assertSafeId(userId, "user")}/jobs/${assertSafeId(jobId, "job")}/`;
}

export function clipRecordKey(userId: string, clipId: string): string {
  return `users/${assertSafeId(userId, "user")}/clips/${assertSafeId(clipId, "clip")}.json`;
}

export function clipPointerKey(clipId: string): string {
  return `clips/${assertSafeId(clipId, "clip")}.json`;
}

export function clipPrefix(userId: string): string {
  return `users/${assertSafeId(userId, "user")}/clips/`;
}

export function parseClipIdFromRecordKey(objectKey: string): string | null {
  const match = /\/clips\/([0-9a-f-]{36})\.json$/i.exec(objectKey);
  return match?.[1] ?? null;
}

export function uploadPrefix(userId: string): string {
  return `users/${assertSafeId(userId, "user")}/uploads/`;
}

export function parseFileIdFromUploadKey(value: string): string | null {
  const match = /(?:^|\/)uploads\/([0-9a-f-]{36})(?:\.|\/|$)/i.exec(value);
  return match?.[1] ?? null;
}

export function jobPointerKey(jobId: string): string {
  return `jobs/${assertSafeId(jobId, "job")}.json`;
}

export function parseJobIdFromRecordKey(objectKey: string): string | null {
  const match = /\/jobs\/([0-9a-f-]{36})\/job\.json$/i.exec(objectKey);
  return match?.[1] ?? null;
}

export const PAIR_CODE_PATTERN = /^[A-Z2-9]{6}$/;

export function normalizePairCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function pairRecordKey(code: string): string {
  if (!PAIR_CODE_PATTERN.test(code)) {
    throw new Error("Invalid pair code");
  }
  return `pairs/${code}.json`;
}

export function ownsObjectKey(userId: string, objectKey: string): boolean {
  return objectKey.startsWith(`users/${userId}/`) && !objectKey.includes("..");
}

export function mediaJobUrl(jobId: string, kind: "source" | "output", download = false): string {
  const base = `/api/media/${jobId}/${kind}`;
  return download ? `${base}?download=1` : base;
}

export function mediaJobThumbUrl(jobId: string, name: string): string {
  return `/api/media/${jobId}/thumb/${name}`;
}

export function mediaUploadUrl(fileId: string, download = false): string {
  const base = `/api/media/upload/${fileId}`;
  return download ? `${base}?download=1` : base;
}

export function mediaUploadThumbUrl(fileId: string, name: string): string {
  return `/api/media/upload/${fileId}/thumb/${name}`;
}
