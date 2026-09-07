import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { missingR2Message } from "@/lib/env";
import { uploadObjectKey } from "@/lib/keys";
import {
  createOutputUploadGrant,
  presignPutUrl,
  r2Enabled,
  R2_PART_SIZE,
  R2_PUT_MAX_BYTES,
} from "@/lib/r2";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenBody = {
  name?: string;
  size?: number;
  contentType?: string;
};

export async function POST(request: Request): Promise<Response> {
  if (!r2Enabled()) {
    return NextResponse.json({ error: missingR2Message() }, { status: 503 });
  }
  const session = await requireSession();
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
  const fileId = crypto.randomUUID();
  const objectKey = uploadObjectKey(session.userId, fileId, ext);
  const contentType = body.contentType && body.contentType.startsWith("video/")
    ? body.contentType
    : "video/mp4";
  if (body.size > R2_PUT_MAX_BYTES) {
    const grant = await createOutputUploadGrant({ objectKey, contentType });
    return NextResponse.json({
      fileId,
      objectKey,
      contentType,
      putUrl: grant.putUrl,
      multipart: grant.multipart,
    });
  }
  const putUrl = await presignPutUrl(objectKey, contentType);
  return NextResponse.json({
    fileId,
    objectKey,
    contentType,
    putUrl,
    multipart: null,
    partSize: R2_PART_SIZE,
  });
}
