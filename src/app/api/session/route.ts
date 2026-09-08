import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  await requireSession();
  return NextResponse.json({ ok: true });
}
