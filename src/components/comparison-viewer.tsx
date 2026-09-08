"use client";

import { useEffect, useRef, useState } from "react";
import { aspectRatioForMeta, formatFps, formatResolution } from "@/lib/format";
import { withDownloadParam } from "@/lib/url";
import type { PublicJob } from "@/lib/types";

type Props = {
  job: PublicJob;
  onContinue?: () => void;
};

export function ComparisonViewer({ job, onContinue }: Props) {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const outputRef = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(52);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const source = sourceRef.current;
    const output = outputRef.current;
    if (!source || !output) {
      return;
    }
    const sync = () => {
      if (Math.abs(source.currentTime - output.currentTime) > 0.08) {
        output.currentTime = source.currentTime;
      }
    };
    source.addEventListener("timeupdate", sync);
    return () => source.removeEventListener("timeupdate", sync);
  }, [job.id]);

  async function toggle() {
    const source = sourceRef.current;
    const output = outputRef.current;
    if (!source || !output) {
      return;
    }
    if (playing) {
      source.pause();
      output.pause();
      setPlaying(false);
      return;
    }
    output.currentTime = source.currentTime;
    await Promise.all([source.play(), output.play()]);
    setPlaying(true);
  }

  const out = job.outputMeta;
  const src = job.sourceMeta;
  const targetMeta = out ?? src;
  const aspect = aspectRatioForMeta(targetMeta);

  return (
    <section className="panel mt-6 overflow-hidden rounded-[28px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Compare</p>
          <h3 className="font-serif text-2xl tracking-tight">Before / after</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void toggle()}
            className="rounded-full border border-[var(--line-strong)] px-4 py-2 text-xs uppercase tracking-[0.16em]"
          >
            {playing ? "Pause" : "Play both"}
          </button>
          {job.outputUrl ? (
            <a
              href={withDownloadParam(job.outputUrl)}
              className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--bg)]"
            >
              Download master
            </a>
          ) : null}
          {onContinue ? (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full border border-[var(--gold)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--gold)]"
            >
              Enhance this master
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="relative flex max-h-[75vh] w-full items-center justify-center overflow-hidden bg-black"
        style={{ aspectRatio: aspect }}
      >
        <video
          ref={outputRef}
          src={job.outputUrl ?? undefined}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        >
          <video
            ref={sourceRef}
            src={job.sourceUrl}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
        <div
          className="absolute inset-y-0 z-10 w-px bg-[var(--gold)]"
          style={{ left: `${split}%` }}
        />
        <input
          type="range"
          min={2}
          max={98}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          className="absolute inset-x-0 bottom-4 z-20 mx-auto w-[70%] accent-[var(--gold)]"
          aria-label="Comparison split"
        />
      </div>
      <div className="grid gap-3 border-t border-[var(--line)] px-6 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] md:grid-cols-2">
        <p>
          Source
          {src
            ? ` · ${formatResolution(src.width, src.height)} · ${formatFps(src.fps)}`
            : ""}
        </p>
        <p>
          Enhanced
          {out
            ? ` · ${formatResolution(out.width, out.height)} · ${formatFps(out.fps)}`
            : ""}
        </p>
      </div>
    </section>
  );
}
