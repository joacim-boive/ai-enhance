# Wrap the SeedVR2 / RIFE Hub image so /ComfyUI/output/*.mp4 is streamed to a
# presigned Cloudflare R2 URL. Do not put R2 secrets in this image.
#
#   docker build -t <registry>/lumen-enhance-worker:r2 \
#     --build-arg HUB_IMAGE=registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2 \
#     -f runpod-worker/Dockerfile runpod-worker
#
# Point the Runpod endpoint at that image. The app mints upload_url + object_key
# per job; this wrapper PUTs the mp4 and returns { object_key, byte_size, etag }.

ARG HUB_IMAGE=registry.runpod.net/wlsdml1114-upscale-interpolation-runpod-hub-main-dockerfile:78b79f1b2
FROM ${HUB_IMAGE}

COPY r2_put.py /r2_put.py
COPY vram.py /vram.py
COPY wrap.py /opt/lumen/wrap.py

RUN if [ -f /handler.py ]; then cp /handler.py /hub_handler.py; fi \
    && cp /opt/lumen/wrap.py /handler.py
