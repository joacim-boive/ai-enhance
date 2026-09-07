import { NextResponse } from "next/server";
import { requireOwnedJob } from "@/lib/authz";
import { patchJob, requestCancel, toPublicJob } from "@/lib/jobs";
import { cancelGpuJob } from "@/lib/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (job.status === "complete" || job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json({ job: toPublicJob(job) });
  }
  requestCancel(id);
  if (job.runpodJobId) {
    await cancelGpuJob(job.runpodJobId);
  }
  const next = await patchJob(id, {
    status: "cancelled",
    stage: "Cancelled",
    error: "Cancelled",
    etaSec: null,
  });
  return NextResponse.json({ job: next ? toPublicJob(next) : toPublicJob(job) });
}
