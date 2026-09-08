# Lumen Enhance

Studio-grade video restoration: **upscale** footage and **lift the frame rate** (24 → 60 fps and friends) with live processing feedback.

Production host: [ai-enhance-ruby.vercel.app](https://ai-enhance-ruby.vercel.app).

## What v1 does

- Drop an MP4 / MOV / WebM / MKV (including multi-GB masters), paste a Google Drive file link, or try a 24 fps sample
- Presets: Restore (2×), Cinema 4K, High Frame Rate (60 fps), Max (4K + 60)
- Custom scale, target fps, denoise, and sharpen
- Live job timeline, ETA, toasts, and a before/after split when the master is ready
- **GPU path**: Runpod serverless worker (`SeedVR2` + `RIFE 4.9`) streams the result to private Cloudflare R2
- **Fallback path**: high-quality CPU encode (Lanczos + motion-compensated interpolation), then a faster blend interpolator if that fails
- Cancel and retry without leaving the bench

Masters are **private**. The object key is `users/{userId}/jobs/{jobId}/output.mp4`. Playback and download go through `/api/media`, which checks the session cookie and 302s to a short-lived SigV4 GET. Guessing a key is not enough. There is no public `*.r2.dev` URL, no base64 payload, and the file is never pulled through a Next.js function as a `Buffer`.

Google Drive file links (Anyone with the link can view) are pulled server-side and streamed into that same private R2 prefix. Folders are rejected. Very large Drive files can hit the function time limit — drop those from disk instead.

## Vercel

This repo is already linked to the Vercel project. Preview and production builds should kick off from Git as usual.

Set these on **Production and Preview**, then **Redeploy**:

```
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=tbsk82cmm6azwh
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
SESSION_SECRET=...
```

Optional: `R2_JURISDICTION=eu` if the bucket uses a jurisdiction endpoint.

The R2 API token only needs **Object Read & Write** on that bucket. Browser uploads PUT straight to a presigned URL, so the bucket also needs CORS. If the token cannot call `PutBucketCors`, add this rule in R2 → bucket → Settings → CORS:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

The header shows **GPU unset** when that deployment cannot read `RUNPOD_API_KEY`, and **R2 unset** when private storage is missing. Adding variables only to Production leaves Preview unset. After changing env vars, Vercel does not patch a live deployment — create a new one.

The GPU worker **never** receives R2 secrets. On submit the app mints a presigned PUT (and multipart part URLs for files above ~5 GB) for that one key and content type, valid a few hours. The worker streams `/ComfyUI/output/….mp4` to R2 and returns `{ object_key, byte_size, etag }`. The app HEADs the object and marks the job complete.

Fluid Compute is on (`vercel.json`) so job processing can continue after the HTTP response via `after()`. Functions stay in **Europe** (`fra1`).

CPU on Vercel uses bundled `ffmpeg-static` / `ffprobe-static` when you pick that engine. Multi-GB interpolations belong on the wrapped GPU worker.

Until `runpod-worker/` is built and pointed at the endpoint, GPU jobs fail closed. Retry on the 4090 — there is no CPU interpolator fallback.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). FFmpeg must be on `PATH` or the bundled static binaries will be used. Without R2, small clips save to local disk. GPU still needs R2 so the worker can upload the master.

## Scripts

| Command        | Purpose                         |
| -------------- | ------------------------------- |
| `npm run dev`  | Studio on `:3000`               |
| `npm test`     | Filter-graph, keys, GPU output  |
| `npm run build`| Production build                |
| `npm run lint` | ESLint                          |
| `graphify query`| Query project knowledge graph  |

## Layout

```
src/app            App Router UI + API
src/components     Studio, compare, toasts
src/lib            Probe, ffmpeg graph, Runpod, R2, jobs
runpod-worker      Hub handler wrap that PUTs to a presigned URL
```

Locally, small jobs can live in `.data/` (gitignored). On Vercel they live in private R2 under `users/{userId}/…`.

## Knowledge Graph (Graphify)

A code knowledge graph is maintained with Graphify:
- **Query the graph**: `graphify query "<question>"`
- **Trace paths**: `graphify path "<source>" "<target>"`
- **Inspect concepts**: `graphify explain "<concept>"`
- **Rebuild graph after edits**: `graphify update .`

