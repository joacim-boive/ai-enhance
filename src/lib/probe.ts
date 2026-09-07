import { spawn } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ffmpegBin, ffprobeBin } from "./binaries";
import { blobEnabled, isVercel } from "./env";
import { parseFrameRate } from "./format";
import { saveBytes } from "./storage";
import { tmpPath } from "./tmp";
import type { VideoMeta } from "./types";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  pix_fmt?: string;
};

type FfprobeFormat = {
  duration?: string;
  size?: string;
};

type FfprobeResult = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function probeVideo(filePath: string): Promise<VideoMeta> {
  const { stdout } = await run(ffprobeBin(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as FfprobeResult;
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  if (!video?.width || !video.height) {
    throw new Error("Could not read video dimensions. The file may be damaged.");
  }
  const fps =
    parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate) || 24;
  const durationSec = Number(video.duration || parsed.format?.duration || 0);
  const frameCount = video.nb_frames ? Number(video.nb_frames) : null;
  return {
    width: video.width,
    height: video.height,
    fps,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    videoCodec: video.codec_name ?? "unknown",
    audioCodec: audio?.codec_name ?? null,
    sizeBytes: Number(parsed.format?.size || 0),
    frameCount: frameCount && Number.isFinite(frameCount) ? frameCount : null,
    pixelFormat: video.pix_fmt ?? null,
  };
}

export async function extractThumbnails(
  filePath: string,
  jobId: string,
  count = 8,
  durationSec = 3,
): Promise<string[]> {
  const dir = tmpPath(`thumbs-${jobId}`);
  await mkdir(dir, { recursive: true });
  const pattern = path.join(dir, "frame-%02d.jpg");
  const span = Math.max(durationSec, 1);
  try {
    await run(ffmpegBin(), [
      "-y",
      "-i",
      filePath,
      "-vf",
      `fps=${count}/${span},scale=240:-2`,
      "-frames:v",
      String(count),
      "-q:v",
      "4",
      pattern,
    ]);
    const files = (await readdir(dir))
      .filter((file) => file.endsWith(".jpg"))
      .sort();
    const urls: string[] = [];
    for (const file of files) {
      const bytes = await readFile(path.join(dir, file));
      if (isVercel() && !blobEnabled()) {
        urls.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
        continue;
      }
      urls.push(await saveBytes(`thumbs/${jobId}/${file}`, bytes, "image/jpeg"));
    }
    return urls;
  } catch {
    return [];
  }
}

export async function ffmpegVersion(): Promise<string | null> {
  try {
    const { stderr, stdout } = await run(ffmpegBin(), ["-version"]);
    const text = stdout || stderr;
    const match = text.match(/ffmpeg version ([^\s]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
