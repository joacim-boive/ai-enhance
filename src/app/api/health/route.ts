import { NextResponse } from "next/server";
import { ffmpegVersion } from "@/lib/probe";
import { gpuHealth } from "@/lib/runpod";
import type { HealthStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const version = await ffmpegVersion();
  const gpu = await gpuHealth();
  return NextResponse.json({
    ffmpeg: { ok: Boolean(version), version },
    gpu,
  });
}
