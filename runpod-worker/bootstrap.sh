#!/bin/bash
# Sit the Lumen wrap in front of the stock Hub image without rebuilding 40 GB of models.
# Used as the endpoint start command, or by docker build (wrap.py is copied in then).
set -euo pipefail

REF="${LUMEN_WORKER_REF:-cursor/gpu-oom-vram-311c}"
BASE="https://raw.githubusercontent.com/joacim-boive/ai-enhance/${REF}/runpod-worker"

mkdir -p /opt/lumen
curl -fsSL "$BASE/vram.py" -o /vram.py
curl -fsSL "$BASE/r2_put.py" -o /r2_put.py
curl -fsSL "$BASE/progress.py" -o /progress.py
curl -fsSL "$BASE/wrap.py" -o /opt/lumen/wrap.py

if [ -f /handler.py ] && [ ! -f /hub_handler.py ]; then
  cp /handler.py /hub_handler.py
fi
cp /opt/lumen/wrap.py /handler.py

echo "Lumen worker wrap installed from ${REF}"
exec /entrypoint.sh
