"use client";

import Link from "next/link";
import { childEntries, type HistoryEntry } from "@/lib/library-tree";
import { formatBytes, formatDuration, formatFps, formatResolution } from "@/lib/format";
import { engineLabel } from "@/lib/settings";
import type { LibraryFamily, PublicClip } from "@/lib/types";
import { ClipStats, downloadHrefFor, downloadNameFor } from "./clip-stats";

type Props = {
  family: LibraryFamily;
  selected: PublicClip;
  history: HistoryEntry[];
  deleting: boolean;
  onSelect: (clip: PublicClip) => void;
  onDelete: (clip: PublicClip) => void;
  onClose: () => void;
};

export function ClipReview({
  family,
  selected,
  history,
  deleting,
  onSelect,
  onDelete,
  onClose,
}: Props) {
  const meta = selected.meta;
  const roots = childEntries(history, null).length
    ? childEntries(history, null)
    : history.filter((entry) => entry.id === family.root.id);

  return (
    <section className="rise mt-2 grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.75fr)]">
      <div className="panel overflow-hidden rounded-[28px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              {selected.kind === "original" ? "Original" : selected.treatment ?? "Version"}
            </p>
            <h2 className="font-serif text-2xl tracking-tight">{selected.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            All clips
          </button>
        </div>
        <div className="aspect-video bg-black">
          <video
            key={selected.id}
            src={selected.url}
            controls
            playsInline
            poster={selected.thumbs[0]}
            className="h-full w-full object-contain"
          />
        </div>
        {selected.thumbs.length > 1 ? (
          <div className="flex gap-1 overflow-x-auto border-t border-[var(--line)] p-2">
            {selected.thumbs.map((thumb) => (
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
        <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-5 py-4">
          <Link
            href={`/?clip=${selected.id}`}
            className="rounded-full bg-[linear-gradient(180deg,#f3d7a8,#c48a42)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#2a1c0a]"
          >
            Enhance this version
          </Link>
          <a
            href={downloadHrefFor(selected)}
            download={downloadNameFor(selected)}
            className="rounded-full bg-[var(--ink)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--bg)]"
          >
            Download
          </a>
          <button
            type="button"
            disabled={deleting}
            onClick={() => onDelete(selected)}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--err)] hover:border-[var(--err)] disabled:opacity-40"
          >
            {deleting ? "Deleting…" : selected.kind === "original" ? "Delete clip" : "Delete version"}
          </button>
        </div>
        <div className="border-t border-[var(--line)] px-5 py-5">
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Stats</p>
          <ClipStats clip={selected} />
          {meta ? (
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {formatResolution(meta.width, meta.height)} · {formatFps(meta.fps)} ·{" "}
              {formatDuration(meta.durationSec)} · {formatBytes(meta.sizeBytes)}
              {selected.engine ? ` · ${engineLabel(selected.engine)}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <aside className="panel rounded-[28px] p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">History</p>
        <h3 className="mt-1 font-serif text-2xl tracking-tight">Treatments</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Every run is kept. Enhance the original again, or keep working from a master.
        </p>
        <ol className="mt-5 grid gap-2">
          {roots.map((entry) => (
            <HistoryNode
              key={entry.id}
              entry={entry}
              entries={history}
              selectedId={selected.id}
              depth={0}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </aside>
    </section>
  );
}

function HistoryNode({
  entry,
  entries,
  selectedId,
  depth,
  onSelect,
}: {
  entry: HistoryEntry;
  entries: HistoryEntry[];
  selectedId: string;
  depth: number;
  onSelect: (clip: PublicClip) => void;
}) {
  const children = childEntries(entries, entry.id);
  const active = entry.clip?.id === selectedId;
  const clip = entry.clip;
  const job = entry.job;
  const meta = clip?.meta ?? (entry.kind === "clip" ? job?.outputMeta : job?.sourceMeta) ?? null;

  return (
    <li style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      {clip ? (
        <button
          type="button"
          onClick={() => onSelect(clip)}
          className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
            active
              ? "border-[var(--gold)] bg-[rgba(226,181,122,0.08)]"
              : "border-[var(--line)] hover:border-[var(--line-strong)]"
          }`}
        >
          <p className="text-sm">{entry.label}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {meta
              ? `${formatResolution(meta.width, meta.height)} · ${formatFps(meta.fps)}`
              : "Ready"}
          </p>
        </button>
      ) : (
        <div className="rounded-2xl border border-[var(--line)] bg-black/20 px-3 py-3">
          <p className="text-sm">{entry.label}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {job ? `${job.status} · ${job.progress}%` : entry.status}
          </p>
          {job && ["queued", "probing", "warming", "processing", "encoding"].includes(job.status) ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
              <div className="progress-sheen h-full" style={{ width: `${Math.max(4, job.progress)}%` }} />
            </div>
          ) : null}
          {job?.error ? <p className="mt-2 text-xs text-[var(--err)]">{job.error}</p> : null}
        </div>
      )}
      {children.length > 0 ? (
        <ol className="relative mt-2 grid gap-2 border-l border-[var(--line)] pl-3">
          {children.map((child) => (
            <HistoryNode
              key={child.id}
              entry={child}
              entries={entries}
              selectedId={selectedId}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
