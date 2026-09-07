"use client";

import { formatBytes, formatDuration, formatFps, formatResolution } from "@/lib/format";
import type { VideoMeta } from "@/lib/types";

type FileInfo = {
  name: string;
  url: string;
  meta: VideoMeta;
  thumbs: string[];
};

type Props = {
  file: FileInfo;
  onClear: () => void;
};

export function SourceStage({ file, onClear }: Props) {
  const { meta } = file;
  return (
    <div className="panel overflow-hidden rounded-[28px]">
      <div className="relative aspect-video bg-black">
        <video
          src={file.url}
          controls
          className="h-full w-full object-contain"
          playsInline
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-4">
        <div>
          <p className="text-sm">{file.name}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {formatResolution(meta.width, meta.height)} · {formatFps(meta.fps)} ·{" "}
            {formatDuration(meta.durationSec)} · {meta.videoCodec} · {formatBytes(meta.sizeBytes)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Replace
        </button>
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
