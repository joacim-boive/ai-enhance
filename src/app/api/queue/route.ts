import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { listJobs, toPublicJob } from "@/lib/jobs";
import { followActiveGpuJobs, getQueueStatus } from "@/lib/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  const session = await requireSession();
  await followActiveGpuJobs(session.userId);
  const jobs = await listJobs(session.userId);
  const queue = getQueueStatus();
  return NextResponse.json({
    jobs: jobs.map(toPublicJob),
    queue,
  });
}
