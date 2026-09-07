import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { ingestLocalVideo } from "@/lib/ingest";
import { requireSession } from "@/lib/authz";
import { ACCEPTED_EXTENSIONS, MAX_FORM_UPLOAD_BYTES } from "@/lib/settings";
import { tmpPath } from "@/lib/tmp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a video file to upload." }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (ext && !ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return NextResponse.json(
      { error: "Use MP4, MOV, WebM, MKV, or AVI." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FORM_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That file is over 80 MB for a direct upload. Use private R2 for larger masters." },
      { status: 413 },
    );
  }

  const session = await requireSession();
  const id = crypto.randomUUID();
  const dest = tmpPath(`${id}${ext || ".mp4"}`);
  const nodeStream = Readable.fromWeb(file.stream() as never);
  try {
    await pipeline(nodeStream, createWriteStream(dest));
    const ingested = await ingestLocalVideo({
      id,
      name: file.name,
      localPath: dest,
      userId: session.userId,
    });
    await unlink(dest).catch(() => undefined);
    return NextResponse.json(ingested);
  } catch (error) {
    await unlink(dest).catch(() => undefined);
    const message =
      error instanceof Error
        ? error.message
        : "Could not read that video. Try exporting it as H.264 MP4.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
