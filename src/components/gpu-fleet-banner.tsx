"use client";

import { gpuShowsFleetBanner } from "@/lib/gpu-health";
import type { HealthStatus } from "@/lib/types";

type Props = {
  gpu: HealthStatus["gpu"];
};

export function GpuFleetBanner({ gpu }: Props) {
  if (!gpuShowsFleetBanner(gpu)) {
    return null;
  }
  const warn =
    gpu.alert ||
    gpu.kind === "throttled" ||
    gpu.kind === "unhealthy" ||
    gpu.kind === "unreachable" ||
    Boolean(gpu.workers && (gpu.workers.throttled > 0 || gpu.workers.unhealthy > 0));
  return (
    <div
      role="status"
      className={`mb-6 rounded-2xl border px-4 py-3 text-sm leading-6 ${
        warn
          ? "border-[var(--gold)]/40 bg-[rgba(226,181,122,0.08)] text-[var(--gold)]"
          : "border-[var(--line)] bg-black/25 text-[var(--ink)]"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
        GPU workers
      </p>
      <p className="mt-1">{gpu.message}</p>
    </div>
  );
}
