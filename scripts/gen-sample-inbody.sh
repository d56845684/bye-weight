#!/usr/bin/env bash
# 在一個 one-shot python:3.11-slim container 裡產 InBody sample 圖片。
# host 不需要裝 Pillow / CJK font。第一次跑會花 ~40 秒裝 fonts-noto-cjk；
# 後續直接用已拉下來的 layer cache。
#
# 傳給 gen_sample_inbody.py 的 args 原樣轉過去，e.g.:
#   bash scripts/gen-sample-inbody.sh --name "張三" --birth-date 1985-03-20
#
# 輸出：scripts/sample-inbody.png
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm \
    -v "$REPO_ROOT/scripts:/work" \
    -w /work \
    python:3.11-slim \
    bash -c '
        set -e
        echo "→ installing fonts-noto-cjk + Pillow..."
        apt-get update -qq
        apt-get install -y -qq --no-install-recommends fonts-noto-cjk >/dev/null
        pip install --quiet Pillow
        echo "→ generating image..."
        python gen_sample_inbody.py "$@"
    ' -- "$@"
