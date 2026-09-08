import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { listLibrary } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await requireSession();
  const families = await listLibrary(session.userId);
  return NextResponse.json({ families });
}
