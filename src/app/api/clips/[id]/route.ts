import { NextResponse } from "next/server";
import { requireOwnedClip, requireSession } from "@/lib/authz";
import { toPublicClip } from "@/lib/clips";
import { deleteClipCascade } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const clip = await requireOwnedClip(id);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  return NextResponse.json({ clip: toPublicClip(clip) });
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const session = await requireSession();
  const { id } = await context.params;
  const clip = await requireOwnedClip(id);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  const deleted = await deleteClipCascade(id, session.userId);
  if (!deleted) {
    return NextResponse.json({ error: "Could not delete that clip" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
