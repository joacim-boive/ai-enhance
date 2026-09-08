import path from "node:path";
import { NextResponse } from "next/server";
import { parseGoogleDriveFileId } from "@/lib/drive";
import { openGoogleDriveDownload } from "@/lib/drive-fetch";
import { missingR2Message, r2Enabled } from "@/lib/env";
import { errorMessageFromUnknown } from "@/lib/http";
import { ingestR2Video } from "@/lib/ingest";
import { uploadObjectKey } from "@/lib/keys";
import { uploadWebStreamToR2 } from "@/lib/r2";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/settings";
import { getRequestSession } from "@/lib/session";
import { contentTypeForName } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DriveBody = {
  url?: string;
};

function extensionFor(name: string, contentType: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return ext;
  }
  if (contentType.includes("quicktime")) {
    return ".mov";
  }
  if (contentType.includes("webm")) {
    return ".webm";
  }
  if (contentType.includes("matroska")) {
    return ".mkv";
  }
  if (contentType.includes("msvideo") || contentType.includes("avi")) {
    return ".avi";
  }
  return ".mp4";
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!r2Enabled()) {
      return NextResponse.json({ error: missingR2Message() }, { status: 503 });
    }
    const session = await getRequestSession();
    const body = (await request.json()) as DriveBody;
    const fileId = body.url ? parseGoogleDriveFileId(body.url) : null;
    if (!fileId) {
      return NextResponse.json(
        { error: "Paste a Google Drive file link, not a folder." },
        { status: 400 },
      );
    }
    const download = await openGoogleDriveDownload(fileId);
    if (download.size && download.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "That Drive file is too large." }, { status: 413 });
    }
    const ext = extensionFor(download.filename, download.contentType);
    const id = crypto.randomUUID();
    const objectKey = uploadObjectKey(session.userId, id, ext);
    const contentType = download.contentType.startsWith("video/")
      ? download.contentType
      : contentTypeForName(download.filename.endsWith(ext) ? download.filename : `${download.filename}${ext}`);
    await uploadWebStreamToR2({
      objectKey,
      body: download.body,
      contentType,
    });
    const ingested = await ingestR2Video({
      id,
      name: path.basename(download.filename, path.extname(download.filename)) + ext,
      userId: session.userId,
      objectKey,
    });
    return NextResponse.json(ingested);
  } catch (error) {
    return NextResponse.json(
      {
        error: errorMessageFromUnknown(
          error,
          "Could not import that Drive file. Share it as Anyone with the link, or drop the file instead.",
        ),
      },
      { status: 422 },
    );
  }
}
