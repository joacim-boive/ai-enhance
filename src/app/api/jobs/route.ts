import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { isVercel, missingR2Message, r2Enabled } from "@/lib/env";
import { ensureOriginalClip, loadClip } from "@/lib/clips";
import { createJob, listJobs, toPublicJob } from "@/lib/jobs";
import { jobOutputKey, mediaJobUrl } from "@/lib/keys";
import { startJob, submitGpuIfReady } from "@/lib/processor";
import { sessionSecretConfigured } from "@/lib/session";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { loadStoredFile } from "@/lib/storage";
import type { Clip, Job, JobSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type CreateBody = {
  clipId?: string;
  fileId?: string;
  name?: string;
  settings?: Partial<JobSettings>;
};

export async function GET(): Promise<Response> {
  const session = await requireSession();
  const jobs = await listJobs(session.userId);
  return NextResponse.json({ jobs: jobs.map(toPublicJob) });
}

export async function POST(request: Request): Promise<Response> {
  if (isVercel() && (!r2Enabled() || !sessionSecretConfigured())) {
    return NextResponse.json({ error: missingR2Message() }, { status: 503 });
  }
  const session = await requireSession();
  const body = (await request.json()) as CreateBody;
  const source = await resolveJobSource(body, session.userId);
  if (!source) {
    return NextResponse.json(
      { error: "Clip not found. Open it from the library or drop the file again." },
      { status: 404 },
    );
  }
  const settings: JobSettings = { ...DEFAULT_SETTINGS, ...body.settings };
  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = {
    id,
    userId: session.userId,
    name: body.name ?? source.name,
    status: "queued",
    engine: null,
    settings,
    sourceClipId: source.id,
    outputClipId: null,
    sourcePath: source.pathname,
    sourceUrl: mediaJobUrl(id, "source"),
    sourceObjectKey: source.objectKey,
    outputPath: null,
    outputUrl: null,
    outputObjectKey: r2Enabled() ? jobOutputKey(session.userId, id) : null,
    outputBytes: null,
    outputEtag: null,
    outputMultipartUploadId: null,
    sourceMeta: source.meta,
    outputMeta: null,
    thumbs: source.thumbs,
    progress: 1,
    stage: "Queued",
    etaSec: null,
    error: null,
    fallbackReason: null,
    events: [
      {
        id: crypto.randomUUID(),
        ts: now,
        stage: "Queued",
        message: "Job accepted. Waiting for a worker.",
        progress: 1,
        level: "info",
      },
    ],
    runpodJobId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    startedAt: null,
  };
  const created = await createJob(job);
  const dispatched = await submitGpuIfReady(created);
  startJob(dispatched.id);
  return NextResponse.json({ job: toPublicJob(dispatched) }, { status: 201 });
}

async function resolveJobSource(
  body: CreateBody,
  userId: string,
): Promise<Clip | null> {
  if (body.clipId) {
    const clip = await loadClip(body.clipId);
    if (clip && clip.userId === userId) {
      return clip;
    }
  }
  if (!body.fileId) {
    return null;
  }
  const stored = await loadStoredFile(body.fileId, userId);
  if (!stored) {
    return null;
  }
  return ensureOriginalClip({
    userId,
    fileId: stored.id,
    name: stored.name,
    url: stored.url,
    pathname: stored.pathname,
    objectKey: stored.objectKey ?? null,
    thumbs: stored.thumbs,
    meta: stored.meta ?? null,
  });
}
