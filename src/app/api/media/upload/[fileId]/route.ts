import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { presignGetUrl, r2Enabled } from "@/lib/r2";
import { localPathFor, loadStoredFile } from "@/lib/storage";
import { streamLocalFile } from "@/lib/stream-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ fileId: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return uploadMedia(request, context);
}

export async function HEAD(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return uploadMedia(request, context);
}

async function uploadMedia(request: Request, context: RouteContext): Promise<Response> {
  const { fileId } = await context.params;
  const session = await requireSession();
  const stored = await loadStoredFile(fileId, session.userId);
  if (!stored) {
    return new Response("Not found", { status: 404 });
  }
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  const objectKey = stored.objectKey;
  if (objectKey && r2Enabled()) {
    const signed = await presignGetUrl(objectKey, {
      downloadName: wantsDownload ? stored.name : undefined,
    });
    return NextResponse.redirect(signed, 302);
  }
  try {
    return await streamLocalFile(localPathFor(stored.pathname), request, {
      downloadName: stored.name,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
