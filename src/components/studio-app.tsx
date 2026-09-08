"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadBrowserFile } from "@/lib/browser-upload";
import { benchFromClip } from "@/lib/library-tree";
import { readJsonResponse } from "@/lib/http";
import { DEFAULT_SETTINGS, treatmentLabel } from "@/lib/settings";
import { playReviewChime } from "@/lib/chime";
import { isActiveJobStatus, summarizeJobs } from "@/lib/queue-summary";
import type {
  BenchSource,
  HealthStatus,
  JobSettings,
  PublicClip,
  PublicJob,
  QueueEvent,
  SourceTransfer,
  Toast,
} from "@/lib/types";
import { AppHeader } from "./app-header";
import { ComparisonViewer } from "./comparison-viewer";
import { DropZone } from "./drop-zone";
import { EnhancePanel } from "./enhance-panel";
import { JobRail } from "./job-rail";
import { QueueView } from "./queue-view";
import { SourceStage } from "./source-stage";
import { ToastViewport } from "./toast-viewport";

type IngestedFile = {
  id: string;
  clipId?: string;
  name: string;
  url: string;
  meta: BenchSource["meta"];
  thumbs: string[];
};

export function StudioApp() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [file, setFile] = useState<BenchSource | null>(null);
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return new URLSearchParams(window.location.search).get("view") === "queue";
  });
  const [uploading, setUploading] = useState(false);
  const [transfer, setTransfer] = useState<SourceTransfer | null>(null);
  const [starting, setStarting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notifiedCompletedIds = useRef<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-4), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 8000);
  }, []);

  const handleReview = useCallback((targetJob: PublicJob) => {
    setReviewJobId(targetJob.id);
    setSelectedJobId(targetJob.id);
  }, []);

  const notifyJobComplete = useCallback(
    (job: PublicJob) => {
      if (notifiedCompletedIds.current.has(job.id)) {
        return;
      }
      notifiedCompletedIds.current.add(job.id);
      pushToast({
        tone: "success",
        title: "Enhancement ready for review",
        body: `${job.name} has finished enhancing. Click to review.`,
        action: {
          label: "Review",
          onClick: () => handleReview(job),
        },
      });
      playReviewChime();
      void notifyBrowser(
        "Enhancement ready for review",
        `${job.name} has finished enhancing. Click to inspect.`,
        () => handleReview(job),
      );
    },
    [handleReview, pushToast],
  );

  const handleIncomingJobUpdate = useCallback(
    (updated: PublicJob) => {
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === updated.id);
        if (exists) {
          return prev.map((j) => (j.id === updated.id ? updated : j));
        }
        return [updated, ...prev];
      });

      if (updated.status === "complete") {
        notifyJobComplete(updated);
      } else if (updated.status === "failed" && !notifiedCompletedIds.current.has(updated.id)) {
        notifiedCompletedIds.current.add(updated.id);
        pushToast({
          tone: "error",
          title: "Could not finish this clip",
          body: updated.error ?? "Try retrying, or switch the engine to CPU.",
        });
      }
    },
    [notifyJobComplete, pushToast],
  );

  const loadJobs = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await readJsonResponse<{ jobs: PublicJob[] }>(response);
      setJobs(data.jobs);

      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        for (const j of data.jobs) {
          if (j.status === "complete") {
            notifiedCompletedIds.current.add(j.id);
          }
        }
      } else {
        for (const j of data.jobs) {
          if (j.status === "complete" && !notifiedCompletedIds.current.has(j.id)) {
            notifyJobComplete(j);
          }
        }
      }
    } catch {
      // Ignore network errors on job polling
    }
  }, [notifyJobComplete]);

  const loadClipOntoBench = useCallback(async (clipId: string) => {
    const response = await fetch(`/api/clips/${clipId}`, { cache: "no-store" });
    const data = await readJsonResponse<{ clip?: PublicClip; error?: string }>(response);
    if (!response.ok || !data.clip) {
      throw new Error(data.error || "Could not open that clip");
    }
    const bench = benchFromClip(data.clip);
    if (!bench) {
      throw new Error("That clip is missing video stats. Try probing it again from an upload.");
    }
    setFile(bench);
  }, []);

  useEffect(() => {
    let unmounted = false;
    const init = async () => {
      const h = await fetchHealth();
      if (!unmounted) {
        setHealth(h);
      }
      await loadJobs();
      const params = new URLSearchParams(window.location.search);
      const clipId = params.get("clip");
      if (clipId && !unmounted) {
        void loadClipOntoBench(clipId).catch(() => undefined);
      }
    };
    void init();
    return () => {
      unmounted = true;
    };
  }, [loadClipOntoBench, loadJobs]);

  // SSE connection for real-time queue and job updates
  useEffect(() => {
    let active = true;
    const source = new EventSource("/api/queue/events");

    source.onmessage = (event) => {
      if (!active) {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as QueueEvent;
        if (payload.type === "init") {
          setJobs(payload.jobs);
          if (!initialLoadDone.current) {
            initialLoadDone.current = true;
            for (const j of payload.jobs) {
              if (j.status === "complete") {
                notifiedCompletedIds.current.add(j.id);
              }
            }
          }
        } else if (payload.type === "job") {
          const updated = payload.job;
          handleIncomingJobUpdate(updated);
        }
      } catch (err) {
        console.error("Failed to parse queue event", err);
      }
    };

    source.onerror = () => {
      // SSE error fallback — polling handles background recovery
    };

    return () => {
      active = false;
      source.close();
    };
  }, [handleIncomingJobUpdate]);

  // Polling fallback while active jobs are running
  const metrics = summarizeJobs(jobs);
  const hasActiveJobs = metrics.active > 0;

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, loadJobs]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        const latest = await fetchHealth();
        if (!cancelled && latest) {
          setHealth(latest);
        }
      })();
    }, hasActiveJobs ? 8000 : 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveJobs]);

  async function uploadFile(input: File) {
    setUploading(true);
    setTransfer({
      phase: "preparing",
      name: input.name,
      loaded: 0,
      total: input.size,
    });
    try {
      const latest = health ?? (await fetchHealth());
      let data: IngestedFile;
      if (latest?.r2?.configured) {
        data = await uploadViaR2(input, setTransfer);
      } else if (latest?.hosting === "vercel") {
        throw new Error(
          "Add Cloudflare R2 credentials so clips upload privately and never pass through Vercel as a Buffer.",
        );
      } else {
        data = await uploadViaForm(input);
      }
      setFile(benchFromIngest(data));
      pushToast({
        tone: "success",
        title: "Clip is on the bench",
        body: `${data.meta.width}×${data.meta.height} at ${Math.round(data.meta.fps)} fps.`,
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not read that file",
        body: error instanceof Error ? error.message : "Try an H.264 MP4.",
      });
    } finally {
      setUploading(false);
      setTransfer(null);
    }
  }

  async function importDrive(url: string) {
    setUploading(true);
    setTransfer({
      phase: "importing",
      name: "Google Drive",
      loaded: 0,
      total: 0,
    });
    try {
      const latest = health ?? (await fetchHealth());
      if (latest?.hosting === "vercel" && !latest.r2?.configured) {
        throw new Error(
          "Add Cloudflare R2 credentials so Drive imports land in private storage.",
        );
      }
      const response = await fetch("/api/ingest/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await readJsonResponse<IngestedFile & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(data.error || "Drive import failed");
      }
      setFile(benchFromIngest(data));
      pushToast({
        tone: "success",
        title: "Clip is on the bench",
        body: `${data.meta.width}×${data.meta.height} at ${Math.round(data.meta.fps)} fps.`,
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not import from Drive",
        body: error instanceof Error ? error.message : "Share the file as Anyone with the link.",
      });
    } finally {
      setUploading(false);
      setTransfer(null);
    }
  }

  async function loadSample() {
    setUploading(true);
    setTransfer({
      phase: "probing",
      name: "24 fps sample",
      loaded: 0,
      total: 0,
    });
    try {
      const response = await fetch("/api/sample", { method: "POST" });
      const data = await readJsonResponse<IngestedFile & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(data.error || "Sample failed");
      }
      setFile(benchFromIngest(data));
      pushToast({
        tone: "info",
        title: "Loaded a 24 fps sample",
        body: "Try High Frame Rate to lift it to 60 fps.",
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Sample unavailable",
        body: error instanceof Error ? error.message : "FFmpeg could not create a clip.",
      });
    } finally {
      setUploading(false);
      setTransfer(null);
    }
  }

  async function enhance() {
    if (!file) {
      return;
    }
    try {
      setStarting(true);
      const latest = health ?? (await fetchHealth());
      if (latest?.hosting === "vercel" && !latest.r2?.configured) {
        throw new Error(
          "Add Cloudflare R2 credentials so enhancement jobs can persist private masters.",
        );
      }
      const jobSettings = settingsForHealth(settings, latest ?? health);
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: file.clipId,
          fileId: file.fileId ?? file.id,
          name: file.name,
          settings: jobSettings,
        }),
      });
      const data = await readJsonResponse<{ job?: PublicJob; error?: string }>(response);
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Could not start the job");
      }

      const createdJob = data.job;
      setJobs((prev) => [createdJob, ...prev.filter((j) => j.id !== createdJob.id)]);
      setSelectedJobId(createdJob.id);

      pushToast({
        tone: "info",
        title: metrics.active > 0 ? "Enhancement queued" : "Enhancement started",
        body:
          metrics.active > 0
            ? `Added to queue as #${metrics.queued + 1}. You can begin another video anytime.`
            : health?.gpu.configured
              ? "Trying GPU first. We’ll fall back if it can’t warm up."
              : "Processing on CPU. You can queue more videos anytime.",
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not start",
        body: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setStarting(false);
    }
  }

  async function cancel(jobId: string) {
    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      const data = await readJsonResponse<{ job?: PublicJob }>(response);
      if (data.job) {
        const nextJob = data.job;
        setJobs((prev) => prev.map((j) => (j.id === jobId ? nextJob : j)));
      }
      pushToast({
        tone: "warn",
        title: "Enhancement cancelled",
        body: "The job was removed from active processing.",
      });
    } catch {
      pushToast({
        tone: "error",
        title: "Could not cancel",
        body: "Unable to cancel the requested job.",
      });
    }
  }

  async function retry(jobId: string) {
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      const data = await readJsonResponse<{ job?: PublicJob }>(response);
      if (data.job) {
        const retried = data.job;
        setJobs((prev) => prev.map((j) => (j.id === jobId ? retried : j)));
        setSelectedJobId(jobId);
        pushToast({
          tone: "info",
          title: "Enhancement requeued",
          body: "Job is back in the queue for processing.",
        });
      }
    } catch {
      pushToast({
        tone: "error",
        title: "Could not retry",
        body: "Unable to retry the job.",
      });
    }
  }

  async function continueFromMaster(targetJob: PublicJob) {
    if (!targetJob.outputUrl || !targetJob.outputMeta) {
      return;
    }
    if (targetJob.outputClipId) {
      try {
        await loadClipOntoBench(targetJob.outputClipId);
        setReviewJobId(null);
        return;
      } catch {
        // Fall through to a local bench from the finished job.
      }
    }
    setFile({
      id: targetJob.outputClipId ?? targetJob.id,
      clipId: targetJob.outputClipId ?? targetJob.id,
      fileId: file?.fileId ?? null,
      name: targetJob.name,
      url: targetJob.outputUrl,
      meta: targetJob.outputMeta,
      thumbs: targetJob.thumbs,
      kind: "version",
      treatment: treatmentLabel(targetJob.settings),
      parentClipId: targetJob.sourceClipId ?? file?.clipId ?? null,
      rootClipId: file?.rootClipId ?? targetJob.sourceClipId ?? targetJob.id,
    });
    setReviewJobId(null);
  }

  // Active / selected jobs for display
  const selectedJob =
    jobs.find((j) => j.id === selectedJobId) ??
    jobs.find((j) => isActiveJobStatus(j.status)) ??
    null;
  const reviewJob = jobs.find((j) => j.id === reviewJobId && j.status === "complete") ?? null;

  const panelSettings = settingsForHealth(settings, health);
  const canEnhance = Boolean(file) && !uploading && !starting;
  const buttonLabel = metrics.active > 0 ? "Queue enhancement" : "Enhance video";
  const workingLabel = uploading ? "Uploading…" : starting ? "Queuing…" : "Working…";

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[1440px] overflow-x-hidden px-5 pb-20 pt-6 md:px-8">
      <AppHeader
        health={health}
        activeJobCount={metrics.active}
        totalJobCount={metrics.total}
        isQueueOpen={showQueue}
        onToggleQueue={() => setShowQueue(!showQueue)}
      />

      {health?.hosting === "vercel" && !health.r2?.configured ? (
        <div className="mb-6 rounded-2xl border border-[var(--gold)]/40 bg-[rgba(226,181,122,0.08)] px-4 py-3 text-sm leading-6 text-[var(--gold)]">
          Cloudflare R2 is unset on this deployment. Private GB masters cannot land until
          R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and
          SESSION_SECRET are set, then Redeploy.
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div>
          {file ? (
            <SourceStage
              file={file}
              onClear={() => {
                setFile(null);
              }}
            />
          ) : (
            <DropZone
              disabled={uploading}
              transfer={transfer}
              onFile={(item) => void uploadFile(item)}
              onSample={() => void loadSample()}
              onDriveUrl={(url) => void importDrive(url)}
            />
          )}
        </div>
        <EnhancePanel
          settings={panelSettings}
          meta={file?.meta ?? null}
          health={health}
          working={starting || uploading}
          workingLabel={workingLabel}
          buttonLabel={buttonLabel}
          canEnhance={canEnhance}
          onChange={setSettings}
          onEnhance={() => void enhance()}
        />
      </div>

      {/* Queue summary bar giving immediate option to view queue & progress */}
      {jobs.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-black/25 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--gold)] font-medium">
              Queue Status
            </span>
            <span className="text-xs text-[var(--muted)]">
              {metrics.active > 0
                ? `${metrics.active} active job${metrics.active === 1 ? "" : "s"} · ${metrics.queued} queued`
                : `${metrics.complete} completed master${metrics.complete === 1 ? "" : "s"} ready for review`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {metrics.complete > 0 && !reviewJob ? (
              <button
                type="button"
                onClick={() => {
                  const latestComplete = jobs.find((j) => j.status === "complete");
                  if (latestComplete) {
                    handleReview(latestComplete);
                  }
                }}
                className="rounded-full bg-[linear-gradient(180deg,#f3d7a8,#c48a42)] px-3.5 py-1.5 text-xs uppercase tracking-[0.14em] font-medium text-[#2a1c0a] hover:opacity-90 transition cursor-pointer"
              >
                Review latest
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowQueue(!showQueue)}
              className="rounded-full border border-[var(--line)] px-4 py-1.5 text-xs uppercase tracking-[0.16em] text-[var(--ink)] hover:border-[var(--line-strong)] transition cursor-pointer"
            >
              {showQueue ? "Hide queue" : `View queue (${jobs.length})`}
            </button>
          </div>
        </div>
      ) : null}

      {/* Full Queue View */}
      {showQueue ? (
        <QueueView
          jobs={jobs}
          selectedJobId={selectedJob?.id ?? null}
          onSelectJob={(j) => setSelectedJobId(j.id === selectedJobId ? null : j.id)}
          onReview={(j) => handleReview(j)}
          onCancel={(id) => void cancel(id)}
          onRetry={(id) => void retry(id)}
          onClose={() => setShowQueue(false)}
        />
      ) : null}

      {/* Review Comparison Viewer when a completed job is chosen for review */}
      {reviewJob && reviewJob.outputUrl ? (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-serif text-xl tracking-tight text-[var(--gold)]">
              Reviewing: {reviewJob.name}
            </p>
          </div>
          <ComparisonViewer
            job={reviewJob}
            onContinue={() => void continueFromMaster(reviewJob)}
            onClose={() => setReviewJobId(null)}
          />
        </div>
      ) : null}

      {/* Single Live Rail for active / inspected job when not in full review mode */}
      {selectedJob && !reviewJob ? (
        <JobRail
          job={selectedJob}
          gpu={health?.gpu ?? null}
          onCancel={() => void cancel(selectedJob.id)}
          onRetry={() => void retry(selectedJob.id)}
        />
      ) : null}

      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
      />
    </div>
  );
}

function benchFromIngest(data: IngestedFile): BenchSource {
  const clipId = data.clipId ?? data.id;
  return {
    id: data.id,
    clipId,
    fileId: data.id,
    name: data.name,
    url: data.url,
    meta: data.meta,
    thumbs: data.thumbs,
    kind: "original",
    treatment: null,
    parentClipId: null,
    rootClipId: clipId,
  };
}

async function notifyBrowser(title: string, body: string, onClick?: () => void): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (permission === "granted") {
    try {
      const notification = new Notification(title, { body });
      if (onClick) {
        notification.onclick = () => {
          window.focus();
          onClick();
          notification.close();
        };
      }
    } catch {
      // Ignore notification failures in restricted sandbox
    }
  }
}

async function fetchHealth(): Promise<HealthStatus | null> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return await readJsonResponse<HealthStatus>(response);
  } catch {
    return null;
  }
}

function settingsForHealth(settings: JobSettings, health: HealthStatus | null): JobSettings {
  if (
    health &&
    settings.enginePreference === "gpu" &&
    (!health.gpu.configured || !health.r2?.configured)
  ) {
    return { ...settings, enginePreference: "auto" };
  }
  return settings;
}

async function uploadViaR2(
  input: File,
  onTransfer: (transfer: SourceTransfer) => void,
): Promise<IngestedFile> {
  onTransfer({
    phase: "preparing",
    name: input.name,
    loaded: 0,
    total: input.size,
  });
  const tokenResponse = await fetch("/api/upload/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      size: input.size,
      contentType: input.type || "video/mp4",
    }),
  });
  const token = await readJsonResponse<{
    fileId?: string;
    objectKey?: string;
    contentType?: string;
    putUrl?: string;
    multipart?: {
      uploadId: string;
      partSize: number;
      partUrls: string[];
    } | null;
    error?: string;
  }>(tokenResponse);
  if (!tokenResponse.ok || !token.fileId || !token.objectKey || !token.putUrl) {
    throw new Error(token.error || "Could not mint a private upload URL");
  }
  onTransfer({
    phase: "uploading",
    name: input.name,
    loaded: 0,
    total: input.size,
  });
  const uploaded = await uploadBrowserFile({
    file: input,
    contentType: token.contentType || input.type || "video/mp4",
    putUrl: token.putUrl,
    multipart: token.multipart ?? null,
    onProgress: (progress) => {
      onTransfer({
        phase: "uploading",
        name: input.name,
        loaded: progress.loaded,
        total: progress.total || input.size,
      });
    },
  });
  onTransfer({
    phase: "probing",
    name: input.name,
    loaded: input.size,
    total: input.size,
  });
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: token.fileId,
      name: input.name,
      objectKey: token.objectKey,
      uploadId: uploaded.uploadId,
      parts: uploaded.parts,
    }),
  });
  const data = await readJsonResponse<IngestedFile & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(data.error || "Could not probe that clip");
  }
  return data;
}

async function uploadViaForm(input: File): Promise<IngestedFile> {
  const body = new FormData();
  body.append("file", input);
  const response = await fetch("/api/upload", { method: "POST", body });
  const data = await readJsonResponse<IngestedFile & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(data.error || "Upload failed");
  }
  return data;
}
