"use client";

import { useState, type FormEvent } from "react";
import { isGoogleDriveUrl } from "@/lib/drive";
import { formatBytes } from "@/lib/format";
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES } from "@/lib/settings";
import type { SourceTransfer } from "@/lib/types";

type Props = {
  disabled?: boolean;
  transfer: SourceTransfer | null;
  onFile: (file: File) => void;
  onSample: () => void;
  onDriveUrl: (url: string) => void;
};

function phaseLabel(phase: SourceTransfer["phase"]): string {
  switch (phase) {
    case "preparing":
      return "Preparing a private upload";
    case "uploading":
      return "Uploading to private storage";
    case "importing":
      return "Pulling from Google Drive";
    case "probing":
      return "Reading the clip";
    default:
      return "Working";
  }
}

export function DropZone({ disabled, transfer, onFile, onSample, onDriveUrl }: Props) {
  const [hot, setHot] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");

  function accept(file: File | undefined) {
    if (!file || disabled) {
      return;
    }
    onFile(file);
  }

  function submitDrive(event: FormEvent) {
    event.preventDefault();
    const next = driveUrl.trim();
    if (!next || disabled) {
      return;
    }
    onDriveUrl(next);
  }

  const percent =
    transfer && transfer.total > 0
      ? Math.min(100, Math.round((transfer.loaded / transfer.total) * 100))
      : null;

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
        if (disabled) {
          return;
        }
        const dropped = event.dataTransfer.files[0];
        if (dropped) {
          accept(dropped);
          return;
        }
        const uri =
          event.dataTransfer.getData("text/uri-list").split("\n")[0]?.trim() ||
          event.dataTransfer.getData("text/plain").trim();
        if (uri && isGoogleDriveUrl(uri)) {
          setDriveUrl(uri);
          onDriveUrl(uri);
        }
      }}
      className={`panel relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-[28px] px-8 py-12 text-center transition ${
        hot ? "border-[var(--gold)]" : ""
      } ${disabled && !transfer ? "opacity-60" : ""}`}
    >
      <div className="pointer-events-none absolute inset-6 rounded-[22px] border border-dashed border-[var(--line-strong)]" />
      {transfer ? (
        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <div className="spinner" aria-hidden="true" />
          <p className="mt-5 font-serif text-3xl tracking-tight">{phaseLabel(transfer.phase)}</p>
          <p className="mt-2 max-w-sm truncate text-sm text-[var(--muted)]">{transfer.name}</p>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={`progress-sheen h-full rounded-full transition-[width] duration-300 ease-out ${percent === null ? "w-1/3" : ""}`}
              style={percent === null ? undefined : { width: `${Math.max(4, percent)}%` }}
            />
          </div>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {percent === null
              ? "Working…"
              : `${percent}% · ${formatBytes(transfer.loaded)} / ${formatBytes(transfer.total)}`}
          </p>
        </div>
      ) : (
        <>
          <p className="font-serif text-4xl tracking-tight md:text-5xl">Drop a clip</p>
          <p className="mt-3 max-w-md text-sm text-[var(--muted)]">
            MP4, MOV, WebM, or MKV — including multi-gigabyte masters. Uploads go
            straight to private storage; this app never holds the file.
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
          <form
            onSubmit={submitDrive}
            className="relative z-10 mt-8 flex w-full max-w-lg flex-col items-center gap-3"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
              Or import from Google Drive
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={driveUrl}
                disabled={disabled}
                onChange={(event) => setDriveUrl(event.target.value)}
                placeholder="https://drive.google.com/file/d/…"
                className="min-w-0 flex-1 rounded-full border border-[var(--line-strong)] bg-black/30 px-4 py-3 text-left text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--gold)]"
              />
              <button
                type="submit"
                disabled={disabled || !driveUrl.trim()}
                className="rounded-full border border-[var(--line-strong)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40"
              >
                Import
              </button>
            </div>
            <p className="max-w-md text-[11px] leading-5 text-[var(--muted)]">
              Share the file as Anyone with the link can view. Folders are not
              supported. Multi-GB Drive imports can time out — drop those locally.
            </p>
          </form>
        </>
      )}
    </div>
  );
}
