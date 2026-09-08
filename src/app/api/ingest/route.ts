import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { ingestR2Video } from "@/lib/ingest";
import { errorMessageFromUnknown } from "@/lib/http";
import { ownsObjectKey } from "@/lib/keys";
import { missingR2Message, r2Enabled } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type IngestBody = {
  id?: string;
  name?: string;
  objectKey?: string;
  uploadId?: string;
  parts?: { partNumber: number; etag: string }[];
};

export async function POST(request: Request): Promise<Response> {
  try {
    if (!r2Enabled()) {
      return NextResponse.json({ error: missingR2Message() }, { status: 503 });
    }
    const session = await requireSession();
    const body = (await request.json()) as IngestBody;
    if (!body.id || !body.name || !body.objectKey) {
      return NextResponse.json({ error: "Missing upload metadata" }, { status: 400 });
    }
    if (!ownsObjectKey(session.userId, body.objectKey)) {
      return NextResponse.json({ error: "Invalid upload path" }, { status: 403 });
    }
    if (!body.objectKey.includes(`/uploads/${body.id}`)) {
      return NextResponse.json({ error: "Upload id does not match the object key" }, { status: 400 });
    }
    const ingested = await ingestR2Video({
      id: body.id,
      name: body.name,
      userId: session.userId,
      objectKey: body.objectKey,
      uploadId: body.uploadId,
      parts: body.parts,
    });
    return NextResponse.json(ingested);
  } catch (error) {
    const message = errorMessageFromUnknown(
      error,
      "Could not read that video. Try exporting it as H.264 MP4.",
    );
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
