import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { ensureDirs, uploadPath } from "@/lib/paths";
import { extractThumbnails, probeVideo } from "@/lib/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  await ensureDirs();
  const id = crypto.randomUUID();
  const dest = uploadPath(id, "sample.mp4");
  try {
    await run("ffmpeg", [
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
    const meta = await probeVideo(dest);
    const thumbs = await extractThumbnails(dest, id, 8, meta.durationSec);
    return NextResponse.json({
      id,
      name: "sample-24fps.mp4",
      url: `/api/media/${id}/source`,
      meta,
      thumbs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create sample";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
