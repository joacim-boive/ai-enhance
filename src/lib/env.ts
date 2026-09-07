export function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
