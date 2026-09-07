import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { ffmpegBin } from "@/lib/binaries";
import { ingestLocalVideo } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} failed`));
        return;
      }
      resolve();
    });
  });
}

export async function POST(): Promise<Response> {
  const id = crypto.randomUUID();
  const dest = path.join(os.tmpdir(), `${id}-sample.mp4`);
  try {
    await run(ffmpegBin(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24:duration=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      dest,
    ]);
    const ingested = await ingestLocalVideo({
      id,
      name: "sample-24fps.mp4",
      localPath: dest,
    });
    await unlink(dest).catch(() => undefined);
    return NextResponse.json(ingested);
  } catch (error) {
    await unlink(dest).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Could not create sample";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
