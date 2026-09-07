export type GraphInput = {
  width: number;
  height: number;
  fps: number;
  scaleChanged: boolean;
  fpsChanged: boolean;
  denoise: boolean;
  sharpen: boolean;
  quality: "high" | "fast";
};

export function buildVideoFilters(input: GraphInput): string {
  const filters: string[] = [];
  if (input.denoise) {
    filters.push(input.quality === "high" ? "hqdn3d=1.2:1.2:6:6" : "hqdn3d=0.8:0.8:3:3");
  }
  if (input.scaleChanged) {
    filters.push(
      `scale=${input.width}:${input.height}:flags=lanczos+accurate_rnd+full_chroma_int:in_range=auto:out_range=tv`,
    );
  }
  if (input.sharpen) {
    filters.push("unsharp=5:5:0.35:5:5:0.0");
  }
  if (input.fpsChanged) {
    if (input.quality === "high") {
      filters.push(
        `minterpolate=fps=${input.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff`,
      );
    } else {
      filters.push(`minterpolate=fps=${input.fps}:mi_mode=blend`);
    }
  }
  return filters.join(",");
}

export function ffmpegArgs(options: {
  inputPath: string;
  outputPath: string;
  filters: string;
  hasAudio: boolean;
  crf?: number;
}): string[] {
  const args: string[] = ["-y", "-hide_banner"];
  if (
    options.inputPath.startsWith("http://") ||
    options.inputPath.startsWith("https://")
  ) {
    args.push(
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "2",
    );
  }
  args.push("-fflags", "+genpts", "-i", options.inputPath, "-map", "0:v:0");
  if (options.filters) {
    args.push("-vf", options.filters);
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(options.crf ?? 16),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
  );
  if (options.hasAudio) {
    args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k", "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(options.outputPath);
  return args;
}
