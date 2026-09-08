"use client";

import { gpuBadgeLabel } from "@/lib/gpu-health";
import type { HealthStatus } from "@/lib/types";

type Props = {
  health: HealthStatus | null;
};

export function EngineBadge({ health }: Props) {
  if (!health) {
    return (
      <div className="rounded-full border border-[var(--line)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        Checking engines
      </div>
    );
  }
  const gpu = health.gpu;
  const gpuTone = gpu.alert
    ? "text-[var(--gold)]"
    : gpu.kind === "warming" || gpu.kind === "running"
      ? "text-[var(--teal)]"
      : gpu.configured
        ? "text-[var(--teal)]"
        : "text-[var(--muted)]";
  const gpuLabel = gpuBadgeLabel(gpu.kind);
  const cpuLabel = health.ffmpeg.ok ? "CPU ready" : "CPU missing";
  const r2Ready = Boolean(health.r2?.configured && health.session?.configured);
  const storageLabel = r2Ready
    ? "R2 ready"
    : health.hosting === "vercel"
      ? "R2 unset"
      : "Local disk";
  const storageTone = r2Ready
    ? "text-[var(--teal)]"
    : health.hosting === "vercel"
      ? "text-[var(--gold)]"
      : "text-[var(--muted)]";
  const storageTitle = r2Ready
    ? "Private Cloudflare R2 is connected. Masters stay scoped to this session."
    : health.hosting === "vercel"
      ? "Add R2 credentials and SESSION_SECRET so GB masters never pass through Vercel."
      : "Saving clips on this machine.";

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]">
      <span className={health.ffmpeg.ok ? "text-[var(--teal)]" : "text-[var(--err)]"}>
        {cpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={gpuTone} title={gpu.message}>
        {gpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={storageTone} title={storageTitle}>
        {storageLabel}
      </span>
    </div>
  );
}
