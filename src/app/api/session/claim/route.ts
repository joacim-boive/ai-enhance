import { NextResponse } from "next/server";
import { errorMessageFromUnknown } from "@/lib/http";
import { normalizePairCode } from "@/lib/keys";
import { claimPairCode } from "@/lib/pair";
import { adoptSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimBody = {
  code?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ClaimBody;
    const code = normalizePairCode(typeof body.code === "string" ? body.code : "");
    const userId = await claimPairCode(code);
    if (!userId) {
      return NextResponse.json(
        { error: "That studio code is invalid or has expired." },
        { status: 400 },
      );
    }
    await adoptSession(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessageFromUnknown(error, "Could not open that library.") },
      { status: 500 },
    );
  }
}
