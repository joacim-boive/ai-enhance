import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR } from "./paths";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function isInsideDataDir(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(DATA_DIR);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function streamLocalFile(
  filePath: string,
  request: Request,
  options?: { downloadName?: string; cacheControl?: string },
): Promise<Response> {
  if (!isInsideDataDir(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const info = await stat(filePath);
  const type = mimeFor(filePath);
  const range = request.headers.get("range");
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      return new Response("Invalid range", { status: 416 });
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : info.size - 1;
    const stream = createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = createReadStream(filePath);
  const headers = new Headers({
    "Content-Type": type,
    "Content-Length": String(info.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": options?.cacheControl ?? "no-store",
  });
  if (wantsDownload && options?.downloadName) {
    headers.set("Content-Disposition", `attachment; filename="${options.downloadName}"`);
  }
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
}
