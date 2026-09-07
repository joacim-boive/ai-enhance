import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), ".data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const OUTPUTS_DIR = path.join(DATA_DIR, "outputs");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");

export async function ensureDirs(): Promise<void> {
  await Promise.all(
    [UPLOADS_DIR, JOBS_DIR, OUTPUTS_DIR, THUMBS_DIR].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
}

export function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

export function uploadPath(id: string, filename: string): string {
  const ext = path.extname(filename) || ".mp4";
  return path.join(UPLOADS_DIR, `${id}${ext.toLowerCase()}`);
}

export function outputPath(id: string): string {
  return path.join(OUTPUTS_DIR, `${id}.mp4`);
}

export function thumbDir(id: string): string {
  return path.join(THUMBS_DIR, id);
}

export async function findUpload(id: string): Promise<string | null> {
  await ensureDirs();
  const files = await readdir(UPLOADS_DIR);
  const match = files.find((file) => file.startsWith(id));
  return match ? path.join(UPLOADS_DIR, match) : null;
}
