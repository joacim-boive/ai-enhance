import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

type ProbePackage = {
  path?: string;
};

export function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  if (typeof ffmpegStatic === "string" && ffmpegStatic.length > 0) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

export function ffprobeBin(): string {
  if (process.env.FFPROBE_PATH) {
    return process.env.FFPROBE_PATH;
  }
  const packed = ffprobeStatic as string | ProbePackage | undefined;
  if (typeof packed === "string" && packed.length > 0) {
    return packed;
  }
  if (packed && typeof packed === "object" && packed.path) {
    return packed.path;
  }
  return "ffprobe";
}
