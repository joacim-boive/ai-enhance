import { NextResponse } from "next/server";
import { requireOwnedJob } from "@/lib/authz";
import { appendEvent, loadJob, patchJob, toPublicJob } from "@/lib/jobs";
import { startJob } from "@/lib/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const job = await requireOwnedJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const next = await patchJob(id, {
    status: "queued",
    stage: "Queued",
    progress: 1,
    error: null,
    fallbackReason: null,
    engine: null,
    runpodJobId: null,
    outputClipId: null,
    outputPath: null,
    outputUrl: null,
    outputObjectKey: null,
    outputBytes: null,
    outputEtag: null,
    outputMultipartUploadId: null,
    outputMeta: null,
    completedAt: null,
    startedAt: null,
    etaSec: null,
  });
  await appendEvent(id, {
    stage: "Queued",
    message: "Retrying with the same settings.",
    progress: 1,
    level: "info",
  });
  startJob(id);
  const latest = next ?? (await loadJob(id));
  return NextResponse.json({ job: latest ? toPublicJob(latest) : toPublicJob(job) });
}
