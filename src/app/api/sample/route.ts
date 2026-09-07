import { NextResponse } from "next/server";
import { extractThumbnails, probeVideo } from "@/lib/probe";
import {
  SAMPLE_FILE_ID,
  SAMPLE_FILE_NAME,
  SAMPLE_PUBLIC_PATH,
  SAMPLE_STORED_FILE,
  sampleFilePath,
} from "@/lib/sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(): Promise<Response> {
  try {
    const localPath = sampleFilePath();
    const meta = await probeVideo(localPath);
    const thumbs = await extractThumbnails(
      localPath,
      SAMPLE_FILE_ID,
      8,
      meta.durationSec,
    );
    return NextResponse.json({
      id: SAMPLE_STORED_FILE.id,
      name: SAMPLE_FILE_NAME,
      url: SAMPLE_PUBLIC_PATH,
      meta,
      thumbs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load sample";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
