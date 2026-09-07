"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatFps, formatResolution } from "@/lib/format";
import { withDownloadParam } from "@/lib/url";
import { engineLabel } from "@/lib/settings";
import type { PublicJob } from "@/lib/types";

export function LibraryView() {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/jobs", { cache: "no-store" });
        const data = (await response.json()) as { jobs: PublicJob[] };
        setJobs(data.jobs);
      } catch {
        setError("Could not load the library.");
      }
    })();
  }, []);

  return (
    <section className="rise">
      <h1 className="font-serif text-4xl tracking-tight">Library</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Finished masters from this studio. On Vercel they live in Blob storage.
      </p>
      {error ? <p className="mt-6 text-[var(--err)]">{error}</p> : null}
      {jobs.length === 0 && !error ? (
        <p className="panel mt-8 rounded-[28px] px-6 py-16 text-center text-[var(--muted)]">
          No masters yet. Enhance a clip from the studio.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {jobs.map((job) => (
            <li key={job.id} className="panel overflow-hidden rounded-[24px]">
              <div className="aspect-video bg-black">
                {job.outputUrl ? (
                  <video src={job.outputUrl} className="h-full w-full object-cover" muted />
                ) : job.thumbs[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={job.thumbs[0]} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="px-5 py-4">
                <p className="text-sm">{job.name}</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  {job.status} · {engineLabel(job.engine)}
                  {job.outputMeta
                    ? ` · ${formatResolution(job.outputMeta.width, job.outputMeta.height)} · ${formatFps(job.outputMeta.fps)} · ${formatDuration(job.outputMeta.durationSec)}`
                    : ""}
                </p>
                {job.outputUrl ? (
                  <a
                    href={withDownloadParam(job.outputUrl)}
                    className="mt-3 inline-block text-xs uppercase tracking-[0.16em] text-[var(--gold)]"
                  >
                    Download
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
