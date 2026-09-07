import "server-only";
import { filenameFromContentDisposition } from "./drive";

const UA = "Mozilla/5.0 (compatible; LumenEnhance/1.0; +https://ai-enhance-ruby.vercel.app)";

export type DriveDownload = {
  body: ReadableStream<Uint8Array>;
  filename: string;
  contentType: string;
  size: number | null;
};

function collectCookieHeader(response: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split(";").map((item) => item.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) {
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function looksLikeHtml(contentType: string | null): boolean {
  return Boolean(contentType && /text\/html/i.test(contentType));
}

function wrapDownload(response: Response, fileId: string): DriveDownload {
  if (!response.body) {
    throw new Error("Google Drive returned an empty body.");
  }
  const sizeHeader = response.headers.get("content-length");
  const size = sizeHeader ? Number(sizeHeader) : null;
  const filename = filenameFromContentDisposition(
    response.headers.get("content-disposition"),
    `drive-${fileId}.mp4`,
  );
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  return {
    body: response.body,
    filename,
    contentType,
    size: Number.isFinite(size) && size && size > 0 ? size : null,
  };
}

export async function openGoogleDriveDownload(fileId: string): Promise<DriveDownload> {
  const encoded = encodeURIComponent(fileId);
  const attempts = [
    `https://drive.usercontent.google.com/download?id=${encoded}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encoded}&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encoded}`,
  ];
  let cookie = "";
  for (const url of attempts) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: "follow",
    });
    cookie = collectCookieHeader(response, cookie);
    if (!response.ok) {
      continue;
    }
    if (!looksLikeHtml(response.headers.get("content-type"))) {
      return wrapDownload(response, fileId);
    }
    const html = await response.text();
    const confirm = html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
    if (!confirm) {
      continue;
    }
    const confirmed = await fetch(
      `https://drive.google.com/uc?export=download&id=${encoded}&confirm=${encodeURIComponent(confirm)}`,
      {
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: "follow",
      },
    );
    cookie = collectCookieHeader(confirmed, cookie);
    if (confirmed.ok && !looksLikeHtml(confirmed.headers.get("content-type"))) {
      return wrapDownload(confirmed, fileId);
    }
  }
  throw new Error(
    "Could not read that Drive file. Share it as Anyone with the link can view (Viewer), then paste the link again.",
  );
}
