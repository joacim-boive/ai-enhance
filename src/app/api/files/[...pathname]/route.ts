import path from "node:path";
import { localPathFor } from "@/lib/storage";
import { streamLocalFile } from "@/lib/stream-file";
import { blobEnabled } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ pathname: string[] }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (blobEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const { pathname } = await context.params;
  if (pathname.some((part) => part.includes("..") || part.includes("/") || part.includes("\\"))) {
    return new Response("Not found", { status: 404 });
  }
  const relative = pathname.join("/");
  const filePath = localPathFor(relative);
  const downloadName = path.basename(relative);
  try {
    return await streamLocalFile(filePath, request, {
      downloadName,
      cacheControl: relative.startsWith("thumbs/") ? "public, max-age=86400" : "no-store",
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
