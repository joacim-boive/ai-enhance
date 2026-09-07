import type { HealthStatus } from "./types";

const DEFAULT_ENDPOINT = "npjpz24ig6c47j";

export function runpodConfig(): {
  apiKey: string | null;
  endpointId: string;
} {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() || null;
  const endpointId =
    process.env.RUNPOD_ENDPOINT_ID?.trim() || DEFAULT_ENDPOINT;
  return { apiKey, endpointId };
}

export function isGpuConfigured(): boolean {
  return Boolean(runpodConfig().apiKey);
}

type RunpodRunResponse = {
  id?: string;
  status?: string;
  error?: string;
};

type RunpodStatusResponse = {
  id?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: unknown;
  error?: string;
};

type RunpodHealth = {
  workers?: {
    idle?: number;
    running?: number;
    initializing?: number;
    throttled?: number;
    ready?: number;
  };
};

export async function gpuHealth(): Promise<HealthStatus["gpu"]> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return {
      configured: false,
      endpointId: null,
      ready: false,
      workers: null,
      message: "Add RUNPOD_API_KEY to enable GPU processing. CPU fallback is active.",
    };
  }
  try {
    const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        configured: true,
        endpointId,
        ready: false,
        workers: null,
        message: `GPU endpoint returned ${response.status}. Jobs will fall back to CPU.`,
      };
    }
    const data = (await response.json()) as RunpodHealth;
    const workers = {
      idle: data.workers?.idle ?? 0,
      running: data.workers?.running ?? 0,
      initializing: data.workers?.initializing ?? 0,
      throttled: data.workers?.throttled ?? 0,
    };
    const ready = workers.idle + workers.running + workers.initializing > 0;
    return {
      configured: true,
      endpointId,
      ready,
      workers,
      message: ready
        ? "GPU workers are available."
        : "GPU is cold. The first job warms a worker (~1–2 min), then runs SeedVR2 + RIFE.",
    };
  } catch {
    return {
      configured: true,
      endpointId,
      ready: false,
      workers: null,
      message: "Could not reach Runpod. CPU fallback will be used.",
    };
  }
}

function taskTypeFor(scaleChanged: boolean, fpsChanged: boolean): "upscale" | "upscale_and_interpolation" {
  if (fpsChanged) {
    return "upscale_and_interpolation";
  }
  if (scaleChanged) {
    return "upscale";
  }
  return "upscale_and_interpolation";
}

export async function submitGpuJob(input: {
  videoUrl?: string;
  videoBase64?: string;
  scaleChanged: boolean;
  fpsChanged: boolean;
}): Promise<string> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    throw new Error("GPU is not configured");
  }
  const body: Record<string, unknown> = {
    task_type: taskTypeFor(input.scaleChanged, input.fpsChanged),
    network_volume: false,
  };
  if (input.videoUrl) {
    body.video_url = input.videoUrl;
  } else if (input.videoBase64) {
    body.video_base64 = input.videoBase64;
  } else {
    throw new Error("GPU job needs a public video URL or a small base64 payload");
  }
  const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: body }),
  });
  const data = (await response.json()) as RunpodRunResponse;
  if (!response.ok || !data.id) {
    throw new Error(data.error || `Runpod submit failed (${response.status})`);
  }
  return data.id;
}

export async function getGpuJobStatus(runpodJobId: string): Promise<RunpodStatusResponse> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    throw new Error("GPU is not configured");
  }
  const response = await fetch(
    `https://api.runpod.ai/v2/${endpointId}/status/${runpodJobId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );
  const data = (await response.json()) as RunpodStatusResponse;
  if (!response.ok) {
    throw new Error(data.error || `Runpod status failed (${response.status})`);
  }
  return data;
}

export async function pollGpuJob(
  jobId: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (!runpodConfig().apiKey) {
    throw new Error("GPU is not configured");
  }
  while (!signal.aborted) {
    const data = await getGpuJobStatus(jobId);
    if (data.status === "COMPLETED") {
      return data.output;
    }
    if (
      data.status === "FAILED" ||
      data.status === "CANCELLED" ||
      data.status === "TIMED_OUT"
    ) {
      throw new Error(data.error || `GPU job ${data.status.toLowerCase()}`);
    }
    await sleep(2000, signal);
  }
  throw new Error("Cancelled");
}

export async function cancelGpuJob(runpodJobId: string): Promise<void> {
  const { apiKey, endpointId } = runpodConfig();
  if (!apiKey) {
    return;
  }
  await fetch(`https://api.runpod.ai/v2/${endpointId}/cancel/${runpodJobId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

export function extractRemoteVideoUrl(output: unknown): string | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const record = output as Record<string, unknown>;
  const nested =
    record.output && typeof record.output === "object"
      ? (record.output as Record<string, unknown>)
      : record;
  for (const value of [nested.video_url, nested.url, nested.output_url, nested.path]) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return null;
}

export async function materializeGpuOutput(output: unknown): Promise<Buffer> {
  const inline = extractVideoPayload(output);
  if (inline) {
    return inline;
  }
  const remote = extractRemoteVideoUrl(output);
  if (!remote) {
    throw new Error("GPU finished but did not return a video payload");
  }
  const response = await fetch(remote);
  if (!response.ok) {
    throw new Error(`GPU output download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function extractVideoPayload(output: unknown): Buffer | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const record = output as Record<string, unknown>;
  const nested =
    record.output && typeof record.output === "object"
      ? (record.output as Record<string, unknown>)
      : record;
  const video = nested.video ?? nested.video_base64 ?? nested.data;
  if (typeof video !== "string" || video.length < 32) {
    return null;
  }
  const payload = video.includes("base64,") ? video.split("base64,")[1] : video;
  try {
    return Buffer.from(payload, "base64");
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      },
      { once: true },
    );
  });
}

export const GPU_BASE64_LIMIT = 8 * 1024 * 1024;
