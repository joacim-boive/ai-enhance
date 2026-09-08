"use client";

import { formatBytes, formatCodec, formatDate, formatDuration, formatFps, formatResolution } from "@/lib/format";
import { engineLabel, versionFileName } from "@/lib/settings";
import { withDownloadParam } from "@/lib/url";
import type { PublicClip, VideoMeta } from "@/lib/types";

type Props = {
  clip: PublicClip;
};

export function ClipStats({ clip }: Props) {
  const meta = clip.meta;
  const rows = statsRows(clip, meta);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="rounded-2xl border border-[var(--line)] bg-black/20 px-4 py-3">
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {row.label}
          </dt>
          <dd className="mt-1 text-sm">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function downloadNameFor(clip: PublicClip): string {
  if (clip.kind === "original") {
    return clip.name;
  }
  return versionFileName(clip.name, clip.settings);
}

export function downloadHrefFor(clip: PublicClip): string {
  return withDownloadParam(clip.url);
}

function statsRows(
  clip: PublicClip,
  meta: VideoMeta | null,
): { label: string; value: string }[] {
  return [
    { label: "Created", value: formatDate(clip.createdAt) },
    { label: "Kind", value: clip.kind === "original" ? "Original upload" : (clip.treatment ?? "Version") },
    { label: "Resolution", value: meta ? formatResolution(meta.width, meta.height) : "—" },
    { label: "Frame rate", value: meta ? formatFps(meta.fps) : "—" },
    { label: "Duration", value: meta ? formatDuration(meta.durationSec) : "—" },
    { label: "Size", value: meta ? formatBytes(meta.sizeBytes) : "—" },
    { label: "Video codec", value: formatCodec(meta?.videoCodec) },
    { label: "Audio codec", value: formatCodec(meta?.audioCodec) },
    { label: "Pixel format", value: meta?.pixelFormat ?? "—" },
    {
      label: "Frames",
      value: meta?.frameCount ? String(meta.frameCount) : "—",
    },
    { label: "Engine", value: clip.kind === "original" ? "Source" : engineLabel(clip.engine) },
    { label: "File", value: clip.kind === "original" ? clip.name : versionFileName(clip.name, clip.settings) },
  ];
}
