import path from "node:path";
import { NextResponse } from "next/server";
import { loadJob } from "@/lib/jobs";
import { localPathFor, loadStoredFile } from "@/lib/storage";
import { streamLocalFile } from "@/lib/stream-file";
import { isHttpUrl, withDownloadParam } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string; kind: string; rest?: string[] }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { jobId, kind, rest = [] } = await context.params;
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  let url: string | null = null;
  let filePath: string | null = null;
  let downloadName = "clip.mp4";
  let cacheControl: string | undefined;

  if (kind === "source") {
    const job = await loadJob(jobId);
    const stored = job ? null : await loadStoredFile(jobId);
    url = job?.sourceUrl ?? stored?.url ?? null;
    downloadName = job?.name ?? stored?.name ?? "source.mp4";
    if (job && !isHttpUrl(job.sourceUrl)) {
      filePath = job.sourcePath.startsWith("/")
        ? job.sourcePath
        : localPathFor(job.sourcePath);
    } else if (stored && !isHttpUrl(stored.url)) {
      filePath = localPathFor(stored.pathname);
    }
  } else if (kind === "output") {
    const job = await loadJob(jobId);
    if (!job) {
      return new Response("Not found", { status: 404 });
    }
    url = job.outputUrl;
    downloadName = enhanceName(job.name);
    if (job.outputPath && !isHttpUrl(job.outputUrl ?? "")) {
      filePath = job.outputPath.startsWith("/")
        ? job.outputPath
        : localPathFor(job.outputPath);
    }
  } else if (kind === "thumb") {
    const filename = rest[0];
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new Response("Not found", { status: 404 });
    }
    filePath = localPathFor(`thumbs/${jobId}/${filename}`);
    cacheControl = "public, max-age=86400";
  } else {
    return new Response("Not found", { status: 404 });
  }

  if (url && isHttpUrl(url)) {
    return NextResponse.redirect(wantsDownload ? withDownloadParam(url) : url);
  }
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }
  try {
    return await streamLocalFile(filePath, request, { downloadName, cacheControl });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function enhanceName(name: string): string {
  const ext = path.extname(name) || ".mp4";
  const base = path.basename(name, ext);
  return `${base}-enhanced.mp4`;
}
