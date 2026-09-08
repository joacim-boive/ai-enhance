"use client";

import { useState } from "react";
import { formatDate, formatEta, formatFps, formatResolution } from "@/lib/format";
import { isActiveJobStatus, summarizeJobs } from "@/lib/queue-summary";
import { engineLabel, treatmentLabel } from "@/lib/settings";
import type { PublicJob } from "@/lib/types";

type Props = {
  jobs: PublicJob[];
  selectedJobId: string | null;
  onSelectJob: (job: PublicJob) => void;
  onReview: (job: PublicJob) => void;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onClose?: () => void;
};

type QueueFilter = "all" | "active" | "completed";

export function QueueView({
  jobs,
  selectedJobId,
  onSelectJob,
  onReview,
  onCancel,
  onRetry,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const metrics = summarizeJobs(jobs);

  const filteredJobs = jobs.filter((job) => {
    if (filter === "active") {
      return isActiveJobStatus(job.status);
    }
    if (filter === "completed") {
      return job.status === "complete";
    }
    return true;
  });

  return (
    <section className="panel mt-6 rounded-[28px] p-6 rise">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-2xl tracking-tight">Enhancement Queue</h2>
            {metrics.active > 0 ? (
              <span className="flex items-center gap-1.5 rounded-full bg-[rgba(65,182,157,0.15)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--teal)]">
                <span className="h-2 w-2 rounded-full bg-[var(--teal)] animate-pulse" />
                {metrics.active} active
              </span>
            ) : null}
            {metrics.queued > 0 ? (
              <span className="rounded-full bg-[rgba(226,181,122,0.12)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--gold)]">
                {metrics.queued} queued
              </span>
            ) : null}
            {metrics.complete > 0 ? (
              <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                {metrics.complete} ready
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Manage concurrent and queued enhancement work. Completed items are ready for review.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-[var(--line)] p-0.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.14em] transition cursor-pointer ${
                filter === "all"
                  ? "bg-[var(--ink)] text-[var(--bg)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              All ({metrics.total})
            </button>
            <button
              type="button"
              onClick={() => setFilter("active")}
              className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.14em] transition cursor-pointer ${
                filter === "active"
                  ? "bg-[var(--ink)] text-[var(--bg)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Active ({metrics.active})
            </button>
            <button
              type="button"
              onClick={() => setFilter("completed")}
              className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.14em] transition cursor-pointer ${
                filter === "completed"
                  ? "bg-[var(--ink)] text-[var(--bg)]"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              Ready ({metrics.complete})
            </button>
          </div>

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-xs uppercase tracking-[0.16em] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-strong)] transition cursor-pointer"
            >
              Hide queue
            </button>
          ) : null}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted)]">
          {filter === "active"
            ? "No active jobs running right now."
            : filter === "completed"
              ? "No completed jobs yet. Start an enhancement above to see it here."
              : "The queue is currently empty. Drop a video or load a sample to begin."}
        </div>
      ) : (
        <ul className="mt-5 grid gap-3">
          {filteredJobs.map((job, index) => {
            const active = isActiveJobStatus(job.status);
            const isSelected = job.id === selectedJobId;
            const srcMeta = job.sourceMeta;
            const outMeta = job.outputMeta;

            return (
              <li
                key={job.id}
                className={`group rounded-2xl border transition p-4 ${
                  isSelected
                    ? "border-[var(--gold)] bg-[rgba(226,181,122,0.06)]"
                    : "border-[var(--line)] bg-black/20 hover:border-[var(--line-strong)]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-black/60 border border-[var(--line)]">
                      {job.thumbs[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={job.thumbs[0]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-[var(--muted)]">
                          VID
                        </div>
                      )}
                      {active ? (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <span className="font-mono text-[10px] text-[var(--gold)] font-medium">
                            {job.progress}%
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {job.name}
                        </p>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                          #{index + 1}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        <span className="text-[var(--gold)]">{treatmentLabel(job.settings)}</span>
                        {" · "}
                        <span>{engineLabel(job.engine)}</span>
                        {srcMeta && outMeta ? (
                          <span>
                            {" · "}
                            {formatResolution(srcMeta.width, srcMeta.height)}{" "}
                            <span className="text-[var(--gold)]">→</span>{" "}
                            {formatResolution(outMeta.width, outMeta.height)} ({formatFps(outMeta.fps)})
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                        {formatDate(job.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {job.status === "complete" ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[rgba(65,182,157,0.15)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--teal)]">
                          Ready for review
                        </span>
                        <button
                          type="button"
                          onClick={() => onReview(job)}
                          className="rounded-full bg-[linear-gradient(180deg,#f3d7a8,#c48a42)] px-4 py-2 text-xs uppercase tracking-[0.16em] font-medium text-[#2a1c0a] hover:opacity-90 shadow-sm transition cursor-pointer"
                        >
                          Review
                        </button>
                      </div>
                    ) : null}

                    {job.status === "queued" ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                          Queued
                        </span>
                        <button
                          type="button"
                          onClick={() => onCancel(job.id)}
                          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--err)] hover:border-[var(--err)] transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}

                    {active && job.status !== "queued" ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 rounded-full bg-[rgba(226,181,122,0.12)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--gold)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] animate-pulse" />
                          {job.progress}%
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectJob(job)}
                          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-strong)] transition cursor-pointer"
                        >
                          {isSelected ? "Hide details" : "Details"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancel(job.id)}
                          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--err)] hover:border-[var(--err)] transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}

                    {job.status === "failed" || job.status === "cancelled" ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[rgba(224,122,106,0.15)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--err)]">
                          {job.status === "failed" ? "Failed" : "Cancelled"}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRetry(job.id)}
                          className="rounded-full bg-[var(--ink)] px-3.5 py-1.5 text-xs uppercase tracking-[0.14em] text-[var(--bg)] hover:opacity-90 transition cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                        job.status === "failed"
                          ? "bg-[var(--err)]"
                          : job.status === "complete"
                            ? "bg-[var(--teal)]"
                            : "progress-sheen"
                      }`}
                      style={{ width: `${Math.max(2, job.progress)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                    <span>{job.stage}</span>
                    <span>
                      {job.status === "complete"
                        ? "Complete"
                        : active
                          ? `ETA ${formatEta(job.etaSec)}`
                          : job.status}
                    </span>
                  </div>
                </div>

                {job.error && (job.status === "failed" || job.status === "cancelled") ? (
                  <p className="mt-2 text-xs text-[var(--err)]">{job.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
