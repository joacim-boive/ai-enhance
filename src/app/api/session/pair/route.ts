import { NextResponse } from "next/server";
import { requireSession } from "@/lib/authz";
import { errorMessageFromUnknown } from "@/lib/http";
import { createPairCode } from "@/lib/pair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const session = await requireSession();
    const minted = await createPairCode(session.userId);
    return NextResponse.json(minted);
  } catch (error) {
    return NextResponse.json(
      { error: errorMessageFromUnknown(error, "Could not mint a studio code.") },
      { status: 500 },
    );
  }
}
