import { NextResponse } from "next/server";
import { requireOwnedJob } from "@/lib/authz";
import { resumeGpuJob } from "@/lib/processor";
import { toPublicJob } from "@/lib/jobs";

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
  const job = await requireOwnedJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  await resumeGpuJob(id);
  const latest = (await requireOwnedJob(id)) ?? job;
  return NextResponse.json({ job: toPublicJob(latest) });
}
