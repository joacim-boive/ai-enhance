const FILE_ID = /^[a-zA-Z0-9_-]{25,80}$/;

export function parseGoogleDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (FILE_ID.test(trimmed)) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const driveHost =
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host === "drive.usercontent.google.com";
  if (!driveHost) {
    return null;
  }
  if (url.pathname.includes("/folders/")) {
    return null;
  }
  const fromQuery = url.searchParams.get("id");
  if (fromQuery && FILE_ID.test(fromQuery)) {
    return fromQuery;
  }
  const fileMatch = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{25,80})/);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }
  return null;
}

export function filenameFromContentDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) {
    return fallback;
  }
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/['"]/g, "").trim()) || fallback;
    } catch {
      return fallback;
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const plain = header.match(/filename=([^;]+)/i);
  if (plain?.[1]) {
    return plain[1].replace(/['"]/g, "").trim() || fallback;
  }
  return fallback;
}

export function isGoogleDriveUrl(input: string): boolean {
  return parseGoogleDriveFileId(input) !== null;
}
