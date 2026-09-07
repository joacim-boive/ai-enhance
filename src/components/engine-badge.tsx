"use client";

import { useEffect, useState } from "react";
import type { HealthStatus } from "@/lib/types";

type Props = {
  health: HealthStatus | null;
};

export function EngineBadge({ health }: Props) {
  const [fetched, setFetched] = useState<HealthStatus | null>(null);

  useEffect(() => {
    if (health) {
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const data = (await response.json()) as HealthStatus;
        if (!cancelled) {
          setFetched(data);
        }
      } catch {
        // Keep the checking state until a later poll succeeds.
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [health]);

  const resolved = health ?? fetched;

  if (!resolved) {
    return (
      <div className="rounded-full border border-[var(--line)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        Checking engines
      </div>
    );
  }
  const gpu = resolved.gpu;
  const gpuTone = gpu.configured
    ? gpu.ready
      ? "text-[var(--teal)]"
      : "text-[var(--gold)]"
    : "text-[var(--muted)]";
  const gpuLabel = !gpu.configured
    ? "GPU unset"
    : gpu.ready
      ? "GPU ready"
      : "GPU cold";
  const cpuLabel = resolved.ffmpeg.ok ? "CPU ready" : "CPU missing";
  const blobLabel = resolved.blob?.configured
    ? "Blob ready"
    : resolved.hosting === "vercel"
      ? "Blob unset"
      : "Local disk";
  const blobTone = resolved.blob?.configured
    ? "text-[var(--teal)]"
    : resolved.hosting === "vercel"
      ? "text-[var(--gold)]"
      : "text-[var(--muted)]";
  const blobTitle = resolved.blob?.configured
    ? "Vercel Blob is connected."
    : resolved.hosting === "vercel"
      ? "Connect a Blob store on this Vercel project so uploads and jobs persist."
      : "Saving clips on this machine.";

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]">
      <span className={resolved.ffmpeg.ok ? "text-[var(--teal)]" : "text-[var(--err)]"}>
        {cpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={gpuTone} title={gpu.message}>
        {gpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={blobTone} title={blobTitle}>
        {blobLabel}
      </span>
    </div>
  );
}
