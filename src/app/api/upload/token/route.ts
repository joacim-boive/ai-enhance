import path from "node:path";
import { NextResponse } from "next/server";
import { missingR2Message, r2Enabled } from "@/lib/env";
import { errorMessageFromUnknown } from "@/lib/http";
import { uploadObjectKey } from "@/lib/keys";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/settings";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenBody = {
  name?: string;
  size?: number;
  contentType?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    if (!r2Enabled()) {
      return NextResponse.json({ error: missingR2Message() }, { status: 503 });
    }
    const session = await getRequestSession();
    const body = (await request.json()) as TokenBody;
    if (!body.name || typeof body.size !== "number") {
      return NextResponse.json({ error: "Missing upload metadata" }, { status: 400 });
    }
    const ext = path.extname(body.name).toLowerCase() || ".mp4";
    if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
      return NextResponse.json({ error: "Use MP4, MOV, WebM, MKV, or AVI." }, { status: 400 });
    }
    if (body.size <= 0 || body.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    }
    const r2 = await import("@/lib/r2");
    const fileId = crypto.randomUUID();
    const objectKey = uploadObjectKey(session.userId, fileId, ext);
    const contentType = body.contentType && body.contentType.startsWith("video/")
      ? body.contentType
      : "video/mp4";
    if (body.size > r2.R2_PUT_MAX_BYTES) {
      const grant = await r2.createOutputUploadGrant({ objectKey, contentType });
      return NextResponse.json({
        fileId,
        objectKey,
        contentType,
        putUrl: grant.putUrl,
        multipart: grant.multipart,
      });
    }
    const putUrl = await r2.presignPutUrl(objectKey, contentType);
    return NextResponse.json({
      fileId,
      objectKey,
      contentType,
      putUrl,
      multipart: null,
      partSize: r2.R2_PART_SIZE,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: errorMessageFromUnknown(
          error,
          "Could not mint a private upload URL. Check the R2 token can PutObject on this bucket.",
        ),
      },
      { status: 500 },
    );
  }
}
