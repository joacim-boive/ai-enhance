import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/index.js",
      "./node_modules/ffprobe-static/bin/linux/x64/**",
    ],
  },
  outputFileTracingExcludes: {
    "/api/**/*": [
      "./node_modules/ffprobe-static/bin/darwin/**",
      "./node_modules/ffprobe-static/bin/win32/**",
    ],
  },
};

export default nextConfig;
