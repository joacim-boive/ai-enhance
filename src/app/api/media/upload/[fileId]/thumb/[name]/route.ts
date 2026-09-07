import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { uploadThumbKey } from "@/lib/keys";
import { presignGetUrl, r2Enabled } from "@/lib/r2";
import { localPathFor, loadStoredFile } from "@/lib/storage";
import { streamLocalFile } from "@/lib/stream-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ fileId: string; name: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { fileId, name } = await context.params;
  if (!name || name.includes("..") || name.includes("/")) {
    return new Response("Not found", { status: 404 });
  }
  const session = await requireSession();
  const stored = await loadStoredFile(fileId, session.userId);
  if (!stored) {
    return new Response("Not found", { status: 404 });
  }
  if (r2Enabled()) {
    const signed = await presignGetUrl(uploadThumbKey(session.userId, fileId, name));
    return NextResponse.redirect(signed, 302);
  }
  try {
    return await streamLocalFile(localPathFor(`thumbs/${fileId}/${name}`), _request, {
      cacheControl: "private, max-age=86400",
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
