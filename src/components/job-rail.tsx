"use client";

import { formatEta } from "@/lib/format";
import { gpuShowsFleetBanner } from "@/lib/gpu-health";
import { liveProcessingEvent } from "@/lib/live-progress";
import { engineLabel } from "@/lib/settings";
import type { HealthStatus, PublicJob } from "@/lib/types";

type Props = {
  job: PublicJob;
  gpu?: HealthStatus["gpu"] | null;
  onCancel: () => void;
  onRetry: () => void;
};

const STAGES = [
  "Queued",
  "Reading source",
  "Warming GPU",
  "Enhancing on GPU",
  "Enhancing on CPU",
  "Fast fallback encode",
  "Ready",
];

export function JobRail({ job, gpu = null, onCancel, onRetry }: Props) {
  const active = ["queued", "probing", "warming", "processing", "encoding"].includes(
    job.status,
  );
  const showGpuFleet = Boolean(active && job.engine === "gpu" && gpu && gpuShowsFleetBanner(gpu));
  const live = liveProcessingEvent(job.events);
  return (
    <section className="panel mt-6 rounded-[28px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            Live processing
          </p>
          <h3 className="mt-1 font-serif text-2xl tracking-tight">{job.stage}</h3>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        {engineLabel(job.engine, job.settings)} · {job.progress}%
        {job.etaSec != null ? ` · ETA ${formatEta(job.etaSec)}` : null}
      </p>
        </div>
        <div className="flex gap-2">
          {active ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)] hover:text-[var(--err)]"
            >
              Cancel
            </button>
          ) : null}
          {job.status === "failed" || job.status === "cancelled" ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--bg)]"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${job.status === "failed" ? "bg-[var(--err)]" : "progress-sheen"}`}
          style={{ width: `${Math.max(2, job.progress)}%` }}
        />
      </div>

      {showGpuFleet && gpu ? (
        <p
          role="status"
          className="mt-4 rounded-2xl border border-[rgba(232,195,106,0.3)] bg-[rgba(232,195,106,0.08)] px-4 py-3 text-sm text-[var(--warn)]"
        >
          {gpu.message}
        </p>
      ) : null}
      {job.fallbackReason && active ? (
        <p className="mt-4 rounded-2xl border border-[rgba(232,195,106,0.3)] bg-[rgba(232,195,106,0.08)] px-4 py-3 text-sm text-[var(--warn)]">
          Fell back after {job.fallbackReason}
        </p>
      ) : null}
      {job.error && job.status === "failed" ? (
        <p className="mt-4 rounded-2xl border border-[rgba(224,122,106,0.35)] bg-[rgba(224,122,106,0.08)] px-4 py-3 text-sm text-[var(--err)]">
          {job.error}
        </p>
      ) : null}

      {live ? (
        <p
          role="status"
          className={`mt-6 rounded-2xl border px-4 py-3 ${
            live.level === "error"
              ? "border-[rgba(224,122,106,0.35)] bg-[rgba(224,122,106,0.08)]"
              : live.level === "warn"
                ? "border-[rgba(232,195,106,0.3)] bg-[rgba(232,195,106,0.08)]"
                : "border-[var(--line)] bg-black/20"
          }`}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {live.stage} · {live.level}
          </span>
          <span className="mt-1 block text-sm">{live.message}</span>
        </p>
      ) : null}
      <p className="mt-4 hidden text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {STAGES.join(" → ")}
      </p>
    </section>
  );
}
