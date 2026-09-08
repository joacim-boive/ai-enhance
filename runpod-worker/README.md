# R2 + VRAM worker wrap

The Hub image (`wlsdml1114/upscale_interpolation_runpod_hub`) copies the finished mp4 to `/runpod-volume` and returns `{ video_path }`, or returns base64 if you ask. Neither is usable for GB masters on Vercel.

It also **always 2× the short side**. A 2160×3840 clip becomes resolution 4320. SeedVR2 then OOMs in Phase 1 (`Allocation on device`) on an RTX 4090.

This wrap:

1. Lets the Hub handler run as usual (ComfyUI output stays scratch on the GPU box / network volume).
2. Caps short side at 2160, tiles the VAE (256–512), drops batch size, and swaps DiT blocks so 4K sources enhance in place instead of trying 8K.
3. Honors `job.input.resolution` from the app (HFR / source-size jobs no longer get an unwanted 2×).
4. When `scale_changed` is false (fps-only), strips SeedVR2 from the Hub graph so RIFE interpolates the source frames instead of running a 1× “upscale”.
5. Sets RIFE’s integer multiplier so the **requested** fps is reachable. 24→60 is 2.5×, so RIFE runs 5× (timesteps 0.2/0.4/0.6/0.8) and the wrap keeps every 2nd frame — those are the exact 60 fps samples — then encodes **once** at 60. No second H.264 generation. 30→60 stays a single 2× pass.
6. Waits for ComfyUI over HTTP history if the Hub websocket drops, so interpolation jobs are not marked GPU-unavailable.
7. Streams the mp4 to the **presigned** `upload_url` the app minted for `users/{userId}/jobs/{jobId}/output.mp4`.
8. Returns `{ object_key, byte_size, etag }` only. No bytes go back through RunPod or Next.js.

The studio app does **not** fall back to Vercel CPU interpolation when a GPU job fails. Retry the GPU job instead.

The worker never receives `R2_SECRET_ACCESS_KEY`. Single PUT under ~5 GB; multipart (64 MB parts) above that.

## Deploy without rebuilding the Hub image

Point the serverless start command at `bootstrap.sh`. It curls this directory from GitHub, replaces `/handler.py`, then execs the Hub entrypoint:

```text
bash -c "curl -fsSL https://raw.githubusercontent.com/joacim-boive/ai-enhance/cursor/gpu-oom-vram-311c/runpod-worker/bootstrap.sh | bash"
```

Set `LUMEN_WORKER_REF` if the files live on another branch. After a wrap change, recycle the worker so the next boot curls the new `vram.py` / `wrap.py`.

## Deploy a rebuilt image

```bash
docker build -t YOUR_REGISTRY/lumen-enhance-worker:r2 \
  --build-arg HUB_IMAGE=registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2 \
  -f runpod-worker/Dockerfile runpod-worker
```

Until the wrap is live, GPU jobs either OOM on 4K (stock Hub) or fail closed on missing object keys. The app does not fall back to CPU.
