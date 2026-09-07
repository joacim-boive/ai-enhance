import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { isVercel, missingR2Message } from "@/lib/env";
import { createJob, listJobs, toPublicJob } from "@/lib/jobs";
import { jobOutputKey, mediaJobUrl } from "@/lib/keys";
import { startJob } from "@/lib/processor";
import { r2Enabled } from "@/lib/r2";
import { sessionSecretConfigured } from "@/lib/session";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { loadStoredFile } from "@/lib/storage";
import type { Job, JobSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type CreateBody = {
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
  if (!body.fileId) {
    return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  }
  const stored = await loadStoredFile(body.fileId, session.userId);
  if (!stored) {
    return NextResponse.json({ error: "Upload not found. Drop the file again." }, { status: 404 });
  }
  const settings: JobSettings = { ...DEFAULT_SETTINGS, ...body.settings };
  const id = crypto.randomUUID();
  const now = Date.now();
  const sourceObjectKey = stored.objectKey ?? null;
  const job: Job = {
    id,
    userId: session.userId,
    name: body.name ?? stored.name,
    status: "queued",
    engine: null,
    settings,
    sourcePath: stored.pathname,
    sourceUrl: mediaJobUrl(id, "source"),
    sourceObjectKey,
    outputPath: null,
    outputUrl: null,
    outputObjectKey: r2Enabled() ? jobOutputKey(session.userId, id) : null,
    outputBytes: null,
    outputEtag: null,
    outputMultipartUploadId: null,
    sourceMeta: null,
    outputMeta: null,
    thumbs: [],
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
  await createJob(job);
  startJob(id);
  return NextResponse.json({ job: toPublicJob(job) }, { status: 201 });
}
