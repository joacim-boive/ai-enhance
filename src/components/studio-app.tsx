"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, DEFAULT_SETTINGS } from "@/lib/settings";
import type { HealthStatus, JobSettings, PublicJob, Toast, VideoMeta } from "@/lib/types";
import { AppHeader } from "./app-header";
import { ComparisonViewer } from "./comparison-viewer";
import { DropZone } from "./drop-zone";
import { EnhancePanel } from "./enhance-panel";
import { JobRail } from "./job-rail";
import { SourceStage } from "./source-stage";
import { ToastViewport } from "./toast-viewport";

type UploadedFile = {
  id: string;
  name: string;
  url: string;
  meta: VideoMeta;
  thumbs: string[];
};

export function StudioApp() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sourceRef = useRef<PublicJob["status"] | null>(null);

  useEffect(() => {
    void refreshHealth();
    const timer = setInterval(() => {
      void refreshHealth();
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    const source = new EventSource(`/api/jobs/${job.id}/events`);
    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as PublicJob;
      setJob(next);
    };
    source.onerror = () => {
      source.close();
    };
    const timer = window.setInterval(() => {
      void pollJob(job.id, false);
    }, 2000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
    // Subscribe once per job id; status updates arrive through the stream and poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  useEffect(() => {
    if (!job) {
      return;
    }
    if (sourceRef.current === job.status) {
      return;
    }
    sourceRef.current = job.status;
    if (job.status === "complete") {
      pushToast({
        tone: "success",
        title: "Master is ready",
        body: job.fallbackReason
          ? "Finished on the fallback engine. Preview the split and download."
          : "Preview the split view and download the enhanced master.",
      });
      notifyBrowser("Enhance complete", job.name);
    }
    if (job.status === "failed") {
      pushToast({
        tone: "error",
        title: "Could not finish this clip",
        body: job.error ?? "Try retrying, or switch the engine to CPU.",
      });
    }
    if (job.fallbackReason && job.engine === "cpu") {
      pushToast({
        tone: "warn",
        title: "Switched to CPU fallback",
        body: job.fallbackReason,
      });
    }
  }, [job]);

  async function refreshHealth() {
    const data = await fetchHealth();
    setHealth(data);
    return data;
  }

  async function pollJob(id: string, repeat = true) {
    try {
      const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { job: PublicJob };
      setJob(data.job);
      if (
        repeat &&
        data.job.status !== "complete" &&
        data.job.status !== "failed" &&
        data.job.status !== "cancelled"
      ) {
        window.setTimeout(() => {
          void pollJob(id);
        }, 1200);
      }
    } catch {
      if (repeat) {
        window.setTimeout(() => {
          void pollJob(id);
        }, 2000);
      }
    }
  }

  function pushToast(toast: Omit<Toast, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-4), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 7000);
  }

  async function uploadFile(input: File) {
    setUploading(true);
    setJob(null);
    try {
      const latest = health ?? (await fetchHealth());
      let data: UploadedFile;
      if (latest?.blob?.configured) {
        data = await uploadViaBlob(input);
      } else if (latest?.hosting === "vercel") {
        throw new Error(
          "Connect a Vercel Blob store to this project so clips can upload past the function body limit.",
        );
      } else {
        data = await uploadViaForm(input);
      }
      setFile(data);
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
    }
  }

  async function loadSample() {
    setUploading(true);
    setJob(null);
    try {
      const response = await fetch("/api/sample", { method: "POST" });
      const data = (await response.json()) as UploadedFile & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Sample failed");
      }
      setFile(data);
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
    }
  }

  async function enhance() {
    if (!file) {
      return;
    }
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          name: file.name,
          settings,
        }),
      });
      const data = (await response.json()) as { job?: PublicJob; error?: string };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Could not start the job");
      }
      setJob(data.job);
      sourceRef.current = data.job.status;
      pushToast({
        tone: "info",
        title: "Enhancement started",
        body: health?.gpu.configured
          ? "Trying the GPU first. We’ll fall back if it can’t warm up."
          : "Processing on CPU with Lanczos and motion interpolation.",
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "Could not start",
        body: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  async function cancel() {
    if (!job) {
      return;
    }
    await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
  }

  async function retry() {
    if (!job) {
      return;
    }
    const response = await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
    const data = (await response.json()) as { job?: PublicJob };
    if (data.job) {
      setJob(data.job);
    }
  }

  const busy =
    uploading ||
    job?.status === "queued" ||
    job?.status === "probing" ||
    job?.status === "warming" ||
    job?.status === "processing" ||
    job?.status === "encoding";

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[1440px] px-5 pb-20 pt-6 md:px-8">
      <AppHeader health={health} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div>
          {file ? (
            <SourceStage
              file={file}
              onClear={() => {
                setFile(null);
                setJob(null);
              }}
            />
          ) : (
            <DropZone disabled={uploading} onFile={(item) => void uploadFile(item)} onSample={() => void loadSample()} />
          )}
        </div>
        <EnhancePanel
          settings={settings}
          meta={file?.meta ?? null}
          busy={Boolean(busy) || !file}
          onChange={setSettings}
          onEnhance={() => void enhance()}
        />
      </div>
      {job ? <JobRail job={job} onCancel={() => void cancel()} onRetry={() => void retry()} /> : null}
      {job?.status === "complete" && job.outputUrl ? <ComparisonViewer job={job} /> : null}
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
      />
    </div>
  );
}

function notifyBrowser(title: string, body: string) {
  if (typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return;
  }
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, { body });
      }
    });
  }
}

async function fetchHealth(): Promise<HealthStatus | null> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return (await response.json()) as HealthStatus;
  } catch {
    return null;
  }
}

function extensionOf(name: string): string {
  const match = /\.[a-z0-9]+$/i.exec(name);
  const ext = match ? match[0].toLowerCase() : ".mp4";
  return ACCEPTED_EXTENSIONS.some((item) => item === ext) ? ext : ".mp4";
}

async function uploadViaForm(input: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", input);
  const response = await fetch("/api/upload", { method: "POST", body });
  const data = (await response.json()) as UploadedFile & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Upload failed");
  }
  return data;
}

async function uploadViaBlob(input: File): Promise<UploadedFile> {
  const id = crypto.randomUUID();
  const blob = await upload(`uploads/${id}${extensionOf(input.name)}`, input, {
    access: "public",
    handleUploadUrl: "/api/upload/token",
    clientPayload: JSON.stringify({ id, name: input.name }),
    multipart: true,
  });
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      name: input.name,
      url: blob.url,
      pathname: blob.pathname,
    }),
  });
  const data = (await response.json()) as UploadedFile & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Could not probe that clip");
  }
  return data;
}
