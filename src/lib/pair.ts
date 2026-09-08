import { randomInt } from "node:crypto";
import { r2Enabled } from "./env";
import { isUuid, PAIR_CODE_PATTERN, pairRecordKey } from "./keys";
import { deleteObject, getJsonObject, putJsonObject } from "./r2";
import { deleteLocalPathname, readJson, saveJson } from "./storage";

export const PAIR_TTL_MS = 10 * 60 * 1000;
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type PairRecord = {
  userId: string;
  expiresAt: number;
};

function randomPairCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  }
  return code;
}

async function savePair(code: string, record: PairRecord): Promise<void> {
  const key = pairRecordKey(code);
  if (r2Enabled()) {
    await putJsonObject(key, record);
    return;
  }
  await saveJson(key, record);
}

async function loadPair(code: string): Promise<PairRecord | null> {
  const key = pairRecordKey(code);
  if (r2Enabled()) {
    return getJsonObject<PairRecord>(key);
  }
  return readJson<PairRecord>(key);
}

async function deletePair(code: string): Promise<void> {
  const key = pairRecordKey(code);
  if (r2Enabled()) {
    await deleteObject(key).catch(() => undefined);
    return;
  }
  await deleteLocalPathname(key);
}

export async function createPairCode(userId: string): Promise<{ code: string; expiresAt: number }> {
  if (!isUuid(userId)) {
    throw new Error("Invalid session.");
  }
  const expiresAt = Date.now() + PAIR_TTL_MS;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomPairCode();
    const existing = await loadPair(code);
    if (existing && existing.expiresAt > Date.now()) {
      continue;
    }
    await savePair(code, { userId, expiresAt });
    return { code, expiresAt };
  }
  throw new Error("Could not mint a studio code. Try again.");
}

export async function claimPairCode(raw: string): Promise<string | null> {
  const code = raw.trim().toUpperCase();
  if (!PAIR_CODE_PATTERN.test(code)) {
    return null;
  }
  const record = await loadPair(code);
  if (!record || record.expiresAt < Date.now() || !isUuid(record.userId)) {
    return null;
  }
  await deletePair(code);
  return record.userId;
}
