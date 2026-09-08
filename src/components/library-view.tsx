"use client";

import { useEffect, useMemo, useState } from "react";
import {
  aspectRatioForMeta,
  formatBytes,
  formatDate,
  formatDuration,
  formatFps,
  formatResolution,
} from "@/lib/format";
import {
  historyEntries,
  latestVersion,
  removeClipFromFamilies,
  versionCount,
} from "@/lib/library-tree";
import type { LibraryFamily, PublicClip, Toast } from "@/lib/types";
import { ClipReview } from "./clip-review";
import { ToastViewport } from "./toast-viewport";

export function LibraryView() {
  const [families, setFamilies] = useState<LibraryFamily[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PublicClip | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(toast: Omit<Toast, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-4), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6000);
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

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
    // Optimistic delete: dismiss confirm modal and immediately remove the clip
    // from state and URL so the UI doesn't stall waiting for remote storage deletion.
    setConfirm(null);
    setError(null);

    const previousFamilies = families;
    const previousSelectedRootId = selectedRootId;
    const previousSelectedClipId = selectedClipId;

    const optimisticFamilies = removeClipFromFamilies(families, clip);
    setFamilies(optimisticFamilies);

    if (clip.kind === "original") {
      if (selectedRootId === clip.id) {
        closeFamily();
      }
    } else if (selectedRootId !== null) {
      const family = optimisticFamilies.find((item) => item.root.id === selectedRootId);
      if (!family) {
        closeFamily();
      } else {
        const fallback =
          family.clips.find((item) => item.id === clip.parentClipId) ?? family.root;
        setSelectedClipId(fallback.id);
        const url = new URL(window.location.href);
        url.searchParams.set("clip", fallback.id);
        window.history.replaceState(null, "", url);
      }
    }

    try {
      const response = await fetch(`/api/clips/${clip.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Could not delete that clip.");
      }
      // Re-sync with server state after successful background delete
      await refresh();
    } catch {
      // Revert optimistic state and notify the user of the failure gracefully
      setFamilies(previousFamilies);
      setSelectedRootId(previousSelectedRootId);
      setSelectedClipId(previousSelectedClipId);
      if (previousSelectedClipId) {
        const url = new URL(window.location.href);
        url.searchParams.set("clip", previousSelectedClipId);
        window.history.replaceState(null, "", url);
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete("clip");
        window.history.replaceState(null, "", url);
      }
      pushToast({
        tone: "error",
        title: "Delete failed",
        body: `Could not delete "${clip.name}". The item has been restored.`,
      });
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
        <ul className="mt-8 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {families.map((family) => (
            <FamilyCard
              key={family.root.id}
              family={family}
              onOpen={() => openFamily(family)}
              onDelete={setConfirm}
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
                onClick={() => void confirmDelete(confirm)}
                className="rounded-full bg-[var(--err)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-white hover:opacity-90"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}

type FamilyCardProps = {
  family: LibraryFamily;
  onOpen: () => void;
  onDelete: (clip: PublicClip) => void;
};

function FamilyCard({ family, onOpen, onDelete }: FamilyCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [calculatedRatio, setCalculatedRatio] = useState<string | null>(null);
  const preview = latestVersion(family);
  const versions = versionCount(family);
  const meta = preview.meta ?? family.root.meta;
  const thumbnail =
    (preview.thumbs && preview.thumbs.length > 0 && preview.thumbs[0])
      ? preview.thumbs[0]
      : (family.root.thumbs && family.root.thumbs.length > 0 && family.root.thumbs[0])
        ? family.root.thumbs[0]
        : null;
  const working = family.jobs.some((job) =>
    ["queued", "probing", "warming", "processing", "encoding"].includes(job.status),
  );

  const effectiveRatio = useMemo(() => {
    return aspectRatioForMeta(meta, calculatedRatio ?? "16 / 9");
  }, [meta, calculatedRatio]);

  return (
    <li className="panel group relative flex flex-col w-full overflow-hidden rounded-[24px] text-left transition hover:border-[var(--line-strong)]">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open ${family.root.name}`}
        className="relative flex w-full cursor-pointer items-center justify-center overflow-hidden bg-black/80 focus:outline-none focus:ring-1 focus:ring-[var(--gold)]"
        style={{ aspectRatio: effectiveRatio }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt={family.root.name}
            loading="lazy"
            className="h-full w-full object-contain"
            onLoad={(event) => {
              const img = event.currentTarget;
              if (!meta?.width && img.naturalWidth && img.naturalHeight) {
                setCalculatedRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
              }
            }}
          />
        ) : null}

        {isHovered && preview.url ? (
          <video
            src={preview.url}
            poster={thumbnail ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            className={`h-full w-full object-contain ${thumbnail ? "absolute inset-0" : ""}`}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (!meta?.width && video.videoWidth && video.videoHeight) {
                setCalculatedRatio(`${video.videoWidth} / ${video.videoHeight}`);
              }
            }}
          />
        ) : !thumbnail && preview.url ? (
          <video
            src={preview.url}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (!meta?.width && video.videoWidth && video.videoHeight) {
                setCalculatedRatio(`${video.videoWidth} / ${video.videoHeight}`);
              }
            }}
          />
        ) : !thumbnail && !preview.url ? (
          <div className="flex h-full w-full items-center justify-center text-[var(--muted)]">
            <span className="font-mono text-xs uppercase tracking-[0.16em]">No preview</span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
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

        <button
          type="button"
          aria-label={`Delete ${family.root.name}`}
          title="Delete video"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(family.root);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          className="absolute right-3 top-3 z-10 flex h-7 items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] backdrop-blur-sm transition hover:bg-[var(--err)] hover:text-white focus:outline-none focus:ring-1 focus:ring-[var(--err)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
              clipRule="evenodd"
            />
          </svg>
          <span>Delete</span>
        </button>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className="cursor-pointer px-5 py-4 focus:outline-none"
      >
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
    </li>
  );
}
