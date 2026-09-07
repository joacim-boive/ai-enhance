import { connection, NextResponse } from "next/server";
import { blobEnabled, hostEnvironment, isVercel } from "@/lib/env";
import { ffmpegVersion } from "@/lib/probe";
import { r2Enabled } from "@/lib/r2";
import { gpuHealth } from "@/lib/runpod";
import { sessionSecretConfigured } from "@/lib/session";
import type { HealthStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<HealthStatus>> {
  await connection();
  const version = await ffmpegVersion();
  const gpu = await gpuHealth();
  return NextResponse.json({
    ffmpeg: { ok: Boolean(version), version },
    blob: { configured: blobEnabled() },
    r2: { configured: r2Enabled() },
    session: { configured: sessionSecretConfigured() },
    hosting: isVercel() ? "vercel" : "local",
    environment: hostEnvironment(),
    gpu,
  });
}
