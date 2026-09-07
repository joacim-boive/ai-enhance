import { NextResponse } from "next/server";
import { loadJob, toPublicJob } from "@/lib/jobs";
import { resumeGpuJob } from "@/lib/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  await resumeGpuJob(id);
  const job = await loadJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job: toPublicJob(job) });
}
