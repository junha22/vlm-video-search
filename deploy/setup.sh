#!/usr/bin/env bash
# IntentCut 서버 설치 스크립트 (Ubuntu 24.04 · Azure B2ats v2 / 메모리 1GB 기준)
#
# 사용법:  bash deploy/setup.sh [도메인]
#   도메인을 생략하면 공인 IP 로 <ip>.sslip.io 주소를 자동으로 만듭니다.
#   다시 실행해도 안전합니다 (비밀번호 변경 등).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
DOMAIN="${1:-}"

echo "==> [1/6] 스왑 메모리 2GB 설정 (메모리 1GB 보완)"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> [2/6] 패키지 설치 (python, ffmpeg, caddy)"
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip ffmpeg git curl gnupg \
  debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "==> [3/6] 파이썬 가상환경 + 패키지"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -q --upgrade pip
"$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

echo "==> [4/6] 환경 변수 (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  read -rsp "    Gemini API Key 입력 (화면에 표시되지 않음): " GEMINI_KEY; echo
  cat > "$APP_DIR/.env" <<EOF
GEMINI_API_KEY=$GEMINI_KEY
YOUTUBE_MODE=url
MAX_UPLOAD_MB=200
MAX_CLIP_SECONDS=120
FFMPEG_THREADS=1
EOF
  chmod 600 "$APP_DIR/.env"
else
  echo "    기존 .env 유지 (수정: nano $APP_DIR/.env)"
fi

echo "==> [5/6] 백엔드 서비스 등록 (systemd · 재부팅 시 자동 실행)"
sudo tee /etc/systemd/system/intentcut.service >/dev/null <<EOF
[Unit]
Description=IntentCut (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable intentcut >/dev/null 2>&1
sudo systemctl restart intentcut

echo "==> [6/6] HTTPS 주소 + 접속 비밀번호 (Caddy)"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
fi
read -rp "    접속 아이디 [admin]: " AUTH_USER
AUTH_USER="${AUTH_USER:-admin}"
read -rsp "    접속 비밀번호 (화면에 표시되지 않음): " AUTH_PW; echo
HASH="$(caddy hash-password --plaintext "$AUTH_PW")"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	encode zstd gzip
	basic_auth {
		$AUTH_USER $HASH
	}
	request_body {
		max_size 210MB
	}
	reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl restart caddy

echo
echo "완료!  https://$DOMAIN   (아이디: $AUTH_USER)"
echo "  - HTTPS 인증서 발급에 1~2분 걸릴 수 있습니다."
echo "  - 상태 확인: sudo systemctl status intentcut caddy"
if [ ! -d "$APP_DIR/frontend/out" ]; then
  echo "  - 아직 화면(frontend/out)이 없습니다. PC 에서 npm run build:static 후 업로드하고"
  echo "    sudo systemctl restart intentcut 을 실행하세요. (deploy/AZURE.md 참고)"
fi
