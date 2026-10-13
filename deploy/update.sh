#!/usr/bin/env bash
# 코드 업데이트: git pull → 패키지 갱신(yt-dlp 최신화) → 백엔드 재시작
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
"$APP_DIR/venv/bin/pip" install -q -r backend/requirements.txt
"$APP_DIR/venv/bin/pip" install -q -U "yt-dlp[default,deno]"
sudo systemctl restart intentcut
echo "업데이트 완료"
