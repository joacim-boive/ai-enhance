import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/browser-upload.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@aws-sdk/client-s3",
              message:
                "The AWS S3 SDK stays on the server. The browser uploads with fetch against presigned URLs.",
            },
            {
              name: "@aws-sdk/lib-storage",
              message:
                "The AWS S3 SDK stays on the server. The browser uploads with fetch against presigned URLs.",
            },
            {
              name: "@aws-sdk/s3-request-presigner",
              message:
                "The AWS S3 SDK stays on the server. The browser uploads with fetch against presigned URLs.",
            },
            {
              name: "@/lib/r2",
              message:
                "R2 SigV4 stays on the server. The browser uploads with fetch against presigned URLs.",
            },
          ],
          patterns: [
            {
              group: ["@aws-sdk", "@aws-sdk/*"],
              message:
                "The AWS S3 SDK stays on the server. The browser uploads with fetch against presigned URLs.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
