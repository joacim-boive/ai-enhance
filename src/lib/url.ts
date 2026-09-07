export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function withDownloadParam(url: string): string {
  if (isHttpUrl(url)) {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  }
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}
