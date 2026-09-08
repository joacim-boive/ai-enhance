import { treatmentLabel } from "./settings";
import type {
  BenchSource,
  JobStatus,
  LibraryFamily,
  PublicClip,
  PublicJob,
} from "./types";

export type HistoryEntry = {
  id: string;
  kind: "clip" | "job";
  clip: PublicClip | null;
  job: PublicJob | null;
  parentId: string | null;
  label: string;
  status: JobStatus | "ready";
};

export function groupFamilies(clips: PublicClip[], jobs: PublicJob[]): LibraryFamily[] {
  const byRoot = new Map<string, PublicClip[]>();
  for (const clip of clips) {
    const key = clip.rootClipId || clip.id;
    const list = byRoot.get(key) ?? [];
    list.push(clip);
    byRoot.set(key, list);
  }

  const families: LibraryFamily[] = [];
  for (const members of byRoot.values()) {
    const sorted = [...members].sort((a, b) => a.createdAt - b.createdAt);
    const root =
      sorted.find((item) => item.kind === "original") ??
      sorted.find((item) => item.id === item.rootClipId) ??
      sorted[0];
    if (!root) {
      continue;
    }
    const clipIds = new Set(sorted.map((item) => item.id));
    const familyJobs = jobs
      .filter(
        (job) =>
          (job.sourceClipId !== null && clipIds.has(job.sourceClipId)) ||
          (job.outputClipId !== null && clipIds.has(job.outputClipId)),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    families.push({
      root,
      clips: sorted,
      jobs: familyJobs,
    });
  }

  return families.sort((a, b) => b.root.createdAt - a.root.createdAt);
}

export function historyEntries(family: LibraryFamily): HistoryEntry[] {
  const entries: HistoryEntry[] = family.clips.map((clip) => {
    const job =
      family.jobs.find((item) => item.outputClipId === clip.id || item.id === clip.jobId) ?? null;
    return {
      id: clip.id,
      kind: "clip",
      clip,
      job,
      parentId: clip.parentClipId,
      label: clip.kind === "original" ? "Original" : (clip.treatment ?? "Version"),
      status: "ready",
    };
  });

  for (const job of family.jobs) {
    if (job.status === "complete" && job.outputClipId) {
      continue;
    }
    entries.push({
      id: job.id,
      kind: "job",
      clip: null,
      job,
      parentId: job.sourceClipId,
      label: treatmentLabel(job.settings),
      status: job.status,
    });
  }

  return entries.sort((a, b) => {
    const left = a.clip?.createdAt ?? a.job?.createdAt ?? 0;
    const right = b.clip?.createdAt ?? b.job?.createdAt ?? 0;
    return left - right;
  });
}

export function childEntries(entries: HistoryEntry[], parentId: string | null): HistoryEntry[] {
  return entries.filter((entry) => entry.parentId === parentId);
}

export function collectDescendantIds(
  clipId: string,
  clips: { id: string; parentClipId: string | null }[],
): string[] {
  const ids = [clipId];
  const queue = [clipId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    for (const clip of clips) {
      if (clip.parentClipId === current && !ids.includes(clip.id)) {
        ids.push(clip.id);
        queue.push(clip.id);
      }
    }
  }
  return ids;
}

export function benchFromClip(clip: PublicClip): BenchSource | null {
  if (!clip.meta) {
    return null;
  }
  return {
    id: clip.kind === "original" && clip.fileId ? clip.fileId : clip.id,
    clipId: clip.id,
    fileId: clip.fileId,
    name: clip.name,
    url: clip.url,
    meta: clip.meta,
    thumbs: clip.thumbs,
    kind: clip.kind,
    treatment: clip.treatment,
    parentClipId: clip.parentClipId,
    rootClipId: clip.rootClipId,
  };
}

export function versionCount(family: LibraryFamily): number {
  return family.clips.filter((clip) => clip.kind === "version").length;
}

export function latestVersion(family: LibraryFamily): PublicClip {
  const versions = family.clips.filter((clip) => clip.kind === "version");
  if (versions.length === 0) {
    return family.root;
  }
  return versions.reduce((latest, clip) => (clip.createdAt > latest.createdAt ? clip : latest));
}

export function removeClipFromFamilies(
  families: LibraryFamily[],
  clip: PublicClip,
): LibraryFamily[] {
  if (clip.kind === "original") {
    return families.filter((family) => family.root.id !== clip.id);
  }

  const doomedIds = new Set(
    collectDescendantIds(
      clip.id,
      families.flatMap((family) => family.clips),
    ),
  );

  return families
    .map((family) => {
      if (!family.clips.some((c) => doomedIds.has(c.id))) {
        return family;
      }
      const remainingClips = family.clips.filter((c) => !doomedIds.has(c.id));
      if (remainingClips.length === 0) {
        return null;
      }
      const remainingJobs = family.jobs.filter(
        (job) =>
          (!job.sourceClipId || !doomedIds.has(job.sourceClipId)) &&
          (!job.outputClipId || !doomedIds.has(job.outputClipId)),
      );
      return {
        ...family,
        clips: remainingClips,
        jobs: remainingJobs,
      };
    })
    .filter((family): family is LibraryFamily => family !== null);
}
