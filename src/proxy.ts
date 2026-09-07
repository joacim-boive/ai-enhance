import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  newSession,
  sessionCookieOptions,
  sessionSecretConfigured,
} from "@/lib/session";

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  if (!sessionSecretConfigured()) {
    return response;
  }
  const existing = decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (existing) {
    return response;
  }
  response.cookies.set(SESSION_COOKIE, encodeSession(newSession()), sessionCookieOptions());
  return response;
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
