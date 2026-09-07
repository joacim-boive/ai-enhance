# R2 worker wrap

The Hub image (`wlsdml1114/upscale_interpolation_runpod_hub`) copies the finished mp4 to `/runpod-volume` and returns `{ video_path }`, or returns base64 if you ask. Neither is usable for GB masters on Vercel.

This wrap:

1. Lets the Hub handler run as usual (ComfyUI output stays scratch on the GPU box / network volume).
2. Streams the mp4 to the **presigned** `upload_url` the app minted for `users/{userId}/jobs/{jobId}/output.mp4`.
3. Returns `{ object_key, byte_size, etag }` only. No bytes go back through RunPod or Next.js.

The worker never receives `R2_SECRET_ACCESS_KEY`. Single PUT under ~5 GB; multipart (64 MB parts) above that.

## Deploy

Build against the Hub image your endpoint already uses, push to a registry Runpod can pull, then set the endpoint’s image to that tag.

```bash
docker build -t YOUR_REGISTRY/lumen-enhance-worker:r2 \
  --build-arg HUB_IMAGE=registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2 \
  -f runpod-worker/Dockerfile runpod-worker
```

Until this image is live, GPU jobs fail closed (“did not upload the master”) and the app falls back to CPU. CPU still streams the result to R2 when credentials are set; it is not a path for multi-GB files on Vercel.
