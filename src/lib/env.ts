import type { HostEnvironment } from "./types";

export type { HostEnvironment };

export function runtimeEnv(name: string): string | undefined {
  const bag: NodeJS.ProcessEnv = process["env"];
  const value = bag[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isVercel(): boolean {
  return runtimeEnv("VERCEL") === "1";
}

export function hostEnvironment(): HostEnvironment {
  const value = runtimeEnv("VERCEL_ENV");
  if (value === "production" || value === "preview" || value === "development") {
    return value;
  }
  return "local";
}

export function blobEnabled(): boolean {
  return Boolean(runtimeEnv("BLOB_READ_WRITE_TOKEN") || runtimeEnv("BLOB_STORE_ID"));
}

export function missingGpuKeyMessage(environment: HostEnvironment = hostEnvironment()): string {
  if (environment === "preview") {
    return "RUNPOD_API_KEY is missing on this Preview deployment. In Vercel → Settings → Environment Variables, enable it for Preview (not only Production), then Redeploy.";
  }
  if (environment === "production") {
    return "RUNPOD_API_KEY is missing on Production. Add it in Vercel → Settings → Environment Variables for Production, then Redeploy.";
  }
  return "Add RUNPOD_API_KEY to .env.local to enable GPU processing. CPU fallback is active.";
}

export function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) {
    return explicit;
  }
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) {
    return `https://${production.replace(/^https?:\/\//, "")}`;
  }
  const preview = process.env.VERCEL_URL?.trim();
  if (preview) {
    return `https://${preview.replace(/^https?:\/\//, "")}`;
  }
  return "";
}

export function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const base = publicBaseUrl();
  if (!base) {
    return pathOrUrl;
  }
  return `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}
