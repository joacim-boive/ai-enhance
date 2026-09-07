import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { ACCEPTED_VIDEO_TYPES, MAX_UPLOAD_BYTES } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH_PATTERN =
  /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATH_PATTERN.test(pathname)) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: [...ACCEPTED_VIDEO_TYPES, "application/octet-stream", "video/*"],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
        };
      },
      onUploadCompleted: async () => {
        // Ingest happens from the client after upload() resolves so localhost works too.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload token failed" },
      { status: 400 },
    );
  }
}
