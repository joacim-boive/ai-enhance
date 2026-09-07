export type JobStatus =
  | "queued"
  | "probing"
  | "warming"
  | "processing"
  | "encoding"
  | "complete"
  | "failed"
  | "cancelled";

export type Engine = "gpu" | "cpu";

export type ScaleMode = "none" | "2x" | "4x" | "1080p" | "1440p" | "4k";

export type FpsMode = "keep" | "30" | "48" | "60" | "120";

export type QualityPreset = "restore" | "cinema" | "hfr" | "max" | "custom";

export type EnginePreference = "auto" | "gpu" | "cpu";

export type VideoMeta = {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  videoCodec: string;
  audioCodec: string | null;
  sizeBytes: number;
  frameCount: number | null;
  pixelFormat: string | null;
};

export type JobSettings = {
  preset: QualityPreset;
  scale: ScaleMode;
  fps: FpsMode;
  denoise: boolean;
  sharpen: boolean;
  enginePreference: EnginePreference;
};

export type JobEventLevel = "info" | "warn" | "error" | "success";

export type JobEvent = {
  id: string;
  ts: number;
  stage: string;
  message: string;
  progress: number;
  level: JobEventLevel;
};

export type Job = {
  id: string;
  userId: string;
  name: string;
  status: JobStatus;
  engine: Engine | null;
  settings: JobSettings;
  sourcePath: string;
  sourceUrl: string;
  sourceObjectKey: string | null;
  outputPath: string | null;
  outputUrl: string | null;
  outputObjectKey: string | null;
  outputBytes: number | null;
  outputEtag: string | null;
  outputMultipartUploadId: string | null;
  sourceMeta: VideoMeta | null;
  outputMeta: VideoMeta | null;
  thumbs: string[];
  progress: number;
  stage: string;
  etaSec: number | null;
  error: string | null;
  fallbackReason: string | null;
  events: JobEvent[];
  runpodJobId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  startedAt: number | null;
};

export type PublicJob = Omit<
  Job,
  | "sourcePath"
  | "outputPath"
  | "sourceObjectKey"
  | "outputObjectKey"
  | "outputEtag"
  | "outputMultipartUploadId"
>;

export type HostEnvironment = "production" | "preview" | "development" | "local";

export type HealthStatus = {
  ffmpeg: { ok: boolean; version: string | null };
  blob: { configured: boolean };
  r2: { configured: boolean };
  session: { configured: boolean };
  hosting: "vercel" | "local";
  environment: HostEnvironment;
  gpu: {
    configured: boolean;
    endpointId: string | null;
    ready: boolean;
    workers: {
      idle: number;
      running: number;
      initializing: number;
      throttled: number;
    } | null;
    message: string;
  };
};

export type ToastTone = "info" | "success" | "warn" | "error";

export type Toast = {
  id: string;
  title: string;
  body: string;
  tone: ToastTone;
};
