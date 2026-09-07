import { NextResponse } from "next/server";
import { blobEnabled, isVercel } from "@/lib/env";
import { ffmpegVersion } from "@/lib/probe";
import { gpuHealth } from "@/lib/runpod";
import type { HealthStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const version = await ffmpegVersion();
  const gpu = await gpuHealth();
  return NextResponse.json({
    ffmpeg: { ok: Boolean(version), version },
    blob: { configured: blobEnabled() },
    hosting: isVercel() ? "vercel" : "local",
    gpu,
  });
}
