"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBytes, formatDate, formatDuration, formatFps, formatResolution } from "@/lib/format";
import { historyEntries, latestVersion, versionCount } from "@/lib/library-tree";
import type { LibraryFamily, PublicClip } from "@/lib/types";
import { ClipReview } from "./clip-review";

export function LibraryView() {
  const [families, setFamilies] = useState<LibraryFamily[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState<PublicClip | null>(null);

  async function refresh() {
    const response = await fetch("/api/library", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load the library.");
    }
    const data = (await response.json()) as { families: LibraryFamily[] };
    setFamilies(data.families);
    return data.families;
  }

  useEffect(() => {
    void (async () => {
      try {
        const next = await refresh();
        const params = new URLSearchParams(window.location.search);
        const wanted = params.get("clip");
        if (wanted) {
          const family = next.find((item) => item.clips.some((clip) => clip.id === wanted));
          if (family) {
            setSelectedRootId(family.root.id);
            setSelectedClipId(wanted);
          }
        }
      } catch {
        setError("Could not load the library.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedFamily = useMemo(
    () => families.find((item) => item.root.id === selectedRootId) ?? null,
    [families, selectedRootId],
  );
  const selectedClip = useMemo(() => {
    if (!selectedFamily) {
      return null;
    }
    return (
      selectedFamily.clips.find((clip) => clip.id === selectedClipId) ??
      latestVersion(selectedFamily)
    );
  }, [selectedFamily, selectedClipId]);
  const history = selectedFamily ? historyEntries(selectedFamily) : [];
  const hasWorkingJobs = families.some((family) =>
    family.jobs.some((job) =>
      ["queued", "probing", "warming", "processing", "encoding"].includes(job.status),
    ),
  );

  useEffect(() => {
    if (!hasWorkingJobs) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasWorkingJobs]);

  function openFamily(family: LibraryFamily, clip?: PublicClip) {
    const next = clip ?? latestVersion(family);
    setSelectedRootId(family.root.id);
    setSelectedClipId(next.id);
    const url = new URL(window.location.href);
    url.searchParams.set("clip", next.id);
    window.history.replaceState(null, "", url);
  }

  function closeFamily() {
    setSelectedRootId(null);
    setSelectedClipId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("clip");
    window.history.replaceState(null, "", url);
  }

  async function confirmDelete(clip: PublicClip) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/clips/${clip.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Could not delete that clip.");
      }
      const next = await refresh();
      setConfirm(null);
      if (clip.kind === "original") {
        closeFamily();
        return;
      }
      const family = next.find((item) => item.root.id === selectedRootId);
      if (!family) {
        closeFamily();
        return;
      }
      const fallback =
        family.clips.find((item) => item.id === clip.parentClipId) ?? family.root;
      setSelectedClipId(fallback.id);
    } catch {
      setError("Could not delete that clip.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Library</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Originals stay on the shelf. Every treatment is a new version you can play,
            download, or send back to the bench.
          </p>
        </div>
        {selectedFamily ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {selectedFamily.clips.length} clip{selectedFamily.clips.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-6 text-[var(--err)]">{error}</p> : null}

      {loading ? (
        <p className="panel mt-8 rounded-[28px] px-6 py-16 text-center text-[var(--muted)]">
          Opening the library…
        </p>
      ) : selectedFamily && selectedClip ? (
        <ClipReview
          family={selectedFamily}
          selected={selectedClip}
          history={history}
          deleting={deleting}
          onSelect={(clip) => {
            setSelectedClipId(clip.id);
            const url = new URL(window.location.href);
            url.searchParams.set("clip", clip.id);
            window.history.replaceState(null, "", url);
          }}
          onDelete={setConfirm}
          onClose={closeFamily}
        />
      ) : families.length === 0 && !error ? (
        <p className="panel mt-8 rounded-[28px] px-6 py-16 text-center text-[var(--muted)]">
          No clips yet. Drop a file in the studio — it will land here so you can try 60 fps,
          then 4K, then both, without uploading again.
        </p>
      ) : !selectedFamily ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {families.map((family) => (
            <FamilyCard
              key={family.root.id}
              family={family}
              onOpen={() => openFamily(family)}
            />
          ))}
        </ul>
      ) : null}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-clip-title"
            className="panel max-w-md rounded-[28px] p-6"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Delete</p>
            <h2 id="delete-clip-title" className="mt-2 font-serif text-2xl tracking-tight">
              {confirm.kind === "original" ? "Delete this clip and its history?" : "Delete this version?"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {confirm.kind === "original"
                ? "The original upload and every treatment made from it will be removed from private storage."
                : "This version and anything derived from it will be removed. The original stays."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete(confirm)}
                className="rounded-full bg-[var(--err)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirm(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FamilyCard({
  family,
  onOpen,
}: {
  family: LibraryFamily;
  onOpen: () => void;
}) {
  const preview = latestVersion(family);
  const versions = versionCount(family);
  const meta = preview.meta ?? family.root.meta;
  const working = family.jobs.some((job) =>
    ["queued", "probing", "warming", "processing", "encoding"].includes(job.status),
  );

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="panel group w-full overflow-hidden rounded-[24px] text-left transition hover:border-[var(--line-strong)]"
      >
        <div className="relative aspect-video bg-black">
          {preview.url ? (
            <video
              src={preview.url}
              poster={preview.thumbs[0] ?? family.root.thumbs[0]}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
              onMouseEnter={(event) => {
                void event.currentTarget.play().catch(() => undefined);
              }}
              onMouseLeave={(event) => {
                event.currentTarget.pause();
                event.currentTarget.currentTime = 0;
              }}
            />
          ) : preview.thumbs[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.thumbs[0]} alt="" className="h-full w-full object-cover" />
          ) : null}
          <div className="absolute left-3 top-3 flex gap-2">
            {versions > 0 ? (
              <span className="rounded-full bg-black/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--gold)]">
                {versions} version{versions === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="rounded-full bg-black/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                Original
              </span>
            )}
            {working ? (
              <span className="rounded-full bg-black/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--teal)]">
                Working
              </span>
            ) : null}
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm">{family.root.name}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {formatDate(family.root.createdAt)}
            {meta
              ? ` · ${formatResolution(meta.width, meta.height)} · ${formatFps(meta.fps)} · ${formatDuration(meta.durationSec)} · ${formatBytes(meta.sizeBytes)}`
              : ""}
          </p>
          {preview.kind === "version" ? (
            <p className="mt-2 text-xs text-[var(--gold)]">Latest · {preview.treatment}</p>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">Ready for another treatment</p>
          )}
        </div>
      </button>
    </li>
  );
}
