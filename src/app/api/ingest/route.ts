import { NextResponse } from "next/server";
import { ingestRemoteVideo } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type IngestBody = {
  id?: string;
  name?: string;
  url?: string;
  pathname?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as IngestBody;
  if (!body.id || !body.name || !body.url || !body.pathname) {
    return NextResponse.json({ error: "Missing upload metadata" }, { status: 400 });
  }
  if (!body.pathname.startsWith("uploads/")) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }
  try {
    const ingested = await ingestRemoteVideo({
      id: body.id,
      name: body.name,
      url: body.url,
      pathname: body.pathname,
    });
    return NextResponse.json(ingested);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not read that video. Try exporting it as H.264 MP4.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
