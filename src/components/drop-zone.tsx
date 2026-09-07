"use client";

import { useState } from "react";
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES } from "@/lib/settings";

type Props = {
  disabled?: boolean;
  onFile: (file: File) => void;
  onSample: () => void;
};

export function DropZone({ disabled, onFile, onSample }: Props) {
  const [hot, setHot] = useState(false);

  function accept(file: File | undefined) {
    if (!file || disabled) {
      return;
    }
    onFile(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
          setHot(true);
        }
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(event) => {
        event.preventDefault();
        setHot(false);
        accept(event.dataTransfer.files[0]);
      }}
      className={`panel relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-[28px] px-8 py-12 text-center transition ${
        hot ? "border-[var(--gold)]" : ""
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="pointer-events-none absolute inset-6 rounded-[22px] border border-dashed border-[var(--line-strong)]" />
      <p className="font-serif text-4xl tracking-tight md:text-5xl">Drop a clip</p>
      <p className="mt-3 max-w-md text-sm text-[var(--muted)]">
        MP4, MOV, WebM, or MKV. We’ll read the cadence, resolve a target, and
        keep you on the timeline the whole way through.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <label className="cursor-pointer rounded-full bg-[var(--ink)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[var(--bg)]">
          Choose file
          <input
            type="file"
            accept={[...ACCEPTED_VIDEO_TYPES, ...ACCEPTED_EXTENSIONS].join(",")}
            className="hidden"
            disabled={disabled}
            onChange={(event) => {
              accept(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={onSample}
          className="rounded-full border border-[var(--line-strong)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Try a 24 fps sample
        </button>
      </div>
    </div>
  );
}
