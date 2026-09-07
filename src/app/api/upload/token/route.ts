import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { ACCEPTED_VIDEO_TYPES, MAX_UPLOAD_BYTES } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH_PATTERN =
  /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

const ALLOWED_CONTENT_TYPES = [...ACCEPTED_VIDEO_TYPES, "application/octet-stream", "video/*"];

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!PATH_PATTERN.test(pathname)) {
          throw new Error("Invalid upload path");
        }
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
        });
        return {
          token,
          urlOptions: {
            addRandomSuffix: false,
            allowOverwrite: true,
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
          },
        };
      },
      onUploadCompleted: async () => {
        // Ingest happens from the client after uploadPresigned() resolves.
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
