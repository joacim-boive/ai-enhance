"use client";

import Link from "next/link";
import {
  aspectRatioForMeta,
  formatBytes,
  formatDuration,
  formatFps,
  formatResolution,
} from "@/lib/format";
import type { BenchSource } from "@/lib/types";

type Props = {
  file: BenchSource;
  onClear: () => void;
};

export function SourceStage({ file, onClear }: Props) {
  const { meta } = file;
  const aspect = aspectRatioForMeta(meta);
  return (
    <div className="panel overflow-hidden rounded-[28px]">
      <div
        className="relative flex max-h-[75vh] w-full items-center justify-center overflow-hidden bg-black"
        style={{ aspectRatio: aspect }}
      >
        <video
          src={file.url}
          controls
          className="h-full w-full object-contain"
          playsInline
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">
            {file.kind === "original" ? "Original on the bench" : file.treatment ?? "Version on the bench"}
          </p>
          <p className="mt-1 text-sm">{file.name}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {formatResolution(meta.width, meta.height)} · {formatFps(meta.fps)} ·{" "}
            {formatDuration(meta.durationSec)} · {meta.videoCodec} · {formatBytes(meta.sizeBytes)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/library?clip=${file.clipId}`}
            className="text-xs uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Library
          </Link>
          <button
            type="button"
            onClick={onClear}
            className="text-xs uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Replace
          </button>
        </div>
      </div>
      {file.thumbs.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--line)] p-2">
          {file.thumbs.map((thumb) => (
            // Local ffmpeg stills from /api/media — next/image is not needed.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={thumb}
              src={thumb}
              alt=""
              className="h-14 w-auto rounded-md object-cover opacity-80"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
