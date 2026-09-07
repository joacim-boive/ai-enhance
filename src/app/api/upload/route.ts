import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { ensureDirs, uploadPath } from "@/lib/paths";
import { extractThumbnails, probeVideo } from "@/lib/probe";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  await ensureDirs();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a video file to upload." }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (ext && !ACCEPTED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: "Use MP4, MOV, WebM, MKV, or AVI." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That file is over 512 MB. Trim it first, then try again." },
      { status: 413 },
    );
  }

  const id = crypto.randomUUID();
  const dest = uploadPath(id, file.name);
  const nodeStream = Readable.fromWeb(file.stream() as never);
  try {
    await pipeline(nodeStream, createWriteStream(dest));
    const meta = await probeVideo(dest);
    const thumbs = await extractThumbnails(dest, id);
    return NextResponse.json({
      id,
      name: file.name,
      url: `/api/media/${id}/source`,
      meta,
      thumbs,
    });
  } catch (error) {
    await unlink(dest).catch(() => undefined);
    const message =
      error instanceof Error
        ? error.message
        : "Could not read that video. Try exporting it as H.264 MP4.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
