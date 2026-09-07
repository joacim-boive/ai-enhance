import path from "node:path";
import { NextResponse } from "next/server";
import { requireOwnedJob } from "@/lib/authz";
import { jobThumbKey } from "@/lib/keys";
import { presignGetUrl, r2Enabled } from "@/lib/r2";
import { SAMPLE_PUBLIC_PATH, SAMPLE_SOURCE_PATH } from "@/lib/sample";
import { localPathFor } from "@/lib/storage";
import { streamLocalFile } from "@/lib/stream-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string; kind: string; rest?: string[] }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return mediaResponse(request, context);
}

export async function HEAD(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return mediaResponse(request, context);
}

async function mediaResponse(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { jobId, kind, rest = [] } = await context.params;
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  const job = await requireOwnedJob(jobId);
  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  if (kind === "thumb") {
    const filename = rest[0];
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new Response("Not found", { status: 404 });
    }
    if (r2Enabled()) {
      const signed = await presignGetUrl(jobThumbKey(job.userId, job.id, filename));
      return NextResponse.redirect(signed, 302);
    }
    try {
      return await streamLocalFile(localPathFor(`thumbs/${jobId}/${filename}`), request, {
        cacheControl: "private, max-age=86400",
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  if (kind === "source") {
    if (job.sourceObjectKey && r2Enabled()) {
      const signed = await presignGetUrl(job.sourceObjectKey, {
        downloadName: wantsDownload ? job.name : undefined,
      });
      return NextResponse.redirect(signed, 302);
    }
    if (job.sourcePath === SAMPLE_SOURCE_PATH) {
      return NextResponse.redirect(new URL(SAMPLE_PUBLIC_PATH, request.url), 302);
    }
    if (job.sourcePath.startsWith("public/")) {
      return NextResponse.redirect(
        new URL(`/${job.sourcePath.replace(/^public\//, "")}`, request.url),
        302,
      );
    }
    try {
      return await streamLocalFile(localPathFor(job.sourcePath), request, {
        downloadName: job.name,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  if (kind === "output") {
    if (job.outputObjectKey && r2Enabled()) {
      const signed = await presignGetUrl(job.outputObjectKey, {
        downloadName: wantsDownload ? enhanceName(job.name) : undefined,
      });
      return NextResponse.redirect(signed, 302);
    }
    if (job.outputPath === SAMPLE_SOURCE_PATH || job.outputPath === job.sourcePath) {
      if (job.sourceObjectKey && r2Enabled()) {
        const signed = await presignGetUrl(job.sourceObjectKey, {
          downloadName: wantsDownload ? enhanceName(job.name) : undefined,
        });
        return NextResponse.redirect(signed, 302);
      }
      if (job.sourcePath === SAMPLE_SOURCE_PATH) {
        return NextResponse.redirect(new URL(SAMPLE_PUBLIC_PATH, request.url), 302);
      }
    }
    if (!job.outputPath) {
      return new Response("Not found", { status: 404 });
    }
    try {
      return await streamLocalFile(localPathFor(job.outputPath), request, {
        downloadName: enhanceName(job.name),
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response("Not found", { status: 404 });
}

function enhanceName(name: string): string {
  const ext = path.extname(name) || ".mp4";
  const base = path.basename(name, ext);
  return `${base}-enhanced.mp4`;
}
