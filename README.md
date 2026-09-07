# Lumen Enhance

Studio-grade video restoration: **upscale** footage and **lift the frame rate** (24 → 60 fps and friends) with live processing feedback. Built to sit beside the existing SaaS GPU fleet on Runpod.

Production host: [ai-enhance-ruby.vercel.app](https://ai-enhance-ruby.vercel.app).

## What v1 does

- Drop an MP4 / MOV / WebM / MKV, or generate a 24 fps sample
- Presets: Restore (2×), Cinema 4K, High Frame Rate (60 fps), Max (4K + 60)
- Custom scale, target fps, denoise, and sharpen
- Live job timeline, ETA, toasts, and a before/after split when the master is ready
- **GPU path**: Runpod serverless worker (`SeedVR2` + `RIFE 4.9`) — endpoint `ai-enhance-video`
- **Fallback path**: high-quality CPU encode (Lanczos + motion-compensated interpolation), then a faster blend interpolator if that fails
- Cancel and retry without leaving the bench

## Vercel

This repo is already linked to the Vercel project. Preview and production builds should kick off from Git as usual.

Connect a **Blob** store to the project (Storage → Blob) so `BLOB_READ_WRITE_TOKEN` is injected. Without it, the studio cannot accept real clips on Vercel — function request bodies cap at 4.5 MB, so the browser uploads straight to Blob.

Also set in the Vercel project (Production + Preview):

```
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=npjpz24ig6c47j
```

`PUBLIC_BASE_URL` is optional once Blob is public: the GPU worker fetches the blob URL directly. Fluid Compute is on (`vercel.json`) so job processing can continue after the HTTP response via `after()`. Frankfurt (`fra1`) is preferred so we stay close to the EU-RO-1 GPU pod.

CPU fallback on Vercel uses bundled `ffmpeg-static` / `ffprobe-static`. Keep clips short for that path; long 4K interpolations belong on the GPU worker.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). FFmpeg must be on `PATH` or the bundled static binaries will be used.

### GPU (optional)

The GPU worker is already deployed on Runpod as `ai-enhance-video`. To use it from this app:

```
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=npjpz24ig6c47j
PUBLIC_BASE_URL=https://your-public-host
```

- Clips **≤ 8 MB** can be sent inline without `PUBLIC_BASE_URL` or Blob
- Larger clips need a publicly reachable source URL (Blob on Vercel, or `PUBLIC_BASE_URL` locally)
- If the GPU is cold, times out, or isn’t configured, the job **falls back to CPU automatically** and the UI says so

## Scripts

| Command        | Purpose                         |
| -------------- | ------------------------------- |
| `npm run dev`  | Studio on `:3000`               |
| `npm test`     | Filter-graph and preset tests   |
| `npm run build`| Production build                |
| `npm run lint` | ESLint                          |

## Layout

```
src/app          App Router UI + API
src/components   Studio, compare, toasts
src/lib          Probe, ffmpeg graph, Runpod, job queue, Blob storage
```

Locally, jobs and uploads live in `.data/` (gitignored). On Vercel they live in Blob (`uploads/`, `outputs/`, `thumbs/`, `jobs/`).
