import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { loadJob } from "@/lib/jobs";
import { findUpload, outputPath, thumbDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string; kind: string; rest?: string[] }>;
};

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

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { jobId, kind, rest = [] } = await context.params;
  let filePath: string | null = null;
  let downloadName: string | null = null;

  if (kind === "source") {
    const job = await loadJob(jobId);
    filePath = job?.sourcePath ?? (await findUpload(jobId));
    downloadName = job?.name ?? "source.mp4";
  } else if (kind === "output") {
    const job = await loadJob(jobId);
    filePath = job?.outputPath ?? outputPath(jobId);
    downloadName = job ? enhanceName(job.name) : "enhanced.mp4";
  } else if (kind === "thumb") {
    const filename = rest[0];
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new Response("Not found", { status: 404 });
    }
    filePath = path.join(thumbDir(jobId), filename);
  } else {
    return new Response("Not found", { status: 404 });
  }

  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const info = await stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
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
      "Cache-Control": kind === "thumb" ? "public, max-age=86400" : "no-store",
    });
    if (wantsDownload && downloadName) {
      headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
    }
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function enhanceName(name: string): string {
  const ext = path.extname(name) || ".mp4";
  const base = path.basename(name, ext);
  return `${base}-enhanced.mp4`;
}
