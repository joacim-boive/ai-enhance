import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { listClips, toPublicClip } from "@/lib/clips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await requireSession();
  const clips = await listClips(session.userId);
  return NextResponse.json({ clips: clips.map(toPublicClip) });
}
