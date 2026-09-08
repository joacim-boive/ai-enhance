import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { hostEnvironment, runtimeEnv } from "./env";

export const SESSION_COOKIE = "lumen_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 400;

export type Session = {
  userId: string;
};

export function sessionSecretConfigured(): boolean {
  return Boolean(runtimeEnv("SESSION_SECRET")) || hostEnvironment() === "local";
}

function sessionSecret(): string {
  const explicit = runtimeEnv("SESSION_SECRET");
  if (explicit) {
    return explicit;
  }
  if (hostEnvironment() === "local") {
    return "lumen-local-session-do-not-use-in-prod";
  }
  throw new Error("Set SESSION_SECRET so private masters stay scoped to one browser session.");
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function encodeSession(session: Session, expiresAt = Date.now() + MAX_AGE_SEC * 1000): string {
  const payload = `${session.userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined | null): Session | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [userId, expText, provided] = parts;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return null;
  }
  const expiresAt = Number(expText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }
  const payload = `${userId}.${expText}`;
  const expected = sign(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return { userId };
}

export function newSession(): Session {
  return { userId: randomUUID() };
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: hostEnvironment() !== "local",
  };
}

export async function writeSessionCookie(session: Session): Promise<void> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(session), sessionCookieOptions());
}

export async function getRequestSession(): Promise<Session> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const parsed = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (parsed) {
    return parsed;
  }
  const session = newSession();
  try {
    await writeSessionCookie(session);
  } catch {
    // Proxy may already have committed Set-Cookie on this request.
  }
  return session;
}

export async function adoptSession(userId: string): Promise<Session> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("Invalid session.");
  }
  const session: Session = { userId };
  await writeSessionCookie(session);
  return session;
}

export function sessionFromRequest(request: Request): Session | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!match) {
    return null;
  }
  return decodeSession(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)));
}
