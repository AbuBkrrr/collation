#!/bin/sh
# One command: ./start.sh   (needs Docker + Docker Compose)
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  r(){ head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  printf 'Domain or IP that phones and room PCs will type (e.g. collation.example.com or 192.168.1.10): '; read D
  printf 'Public IP of this server (use the same IP on a local network): '; read P
  case "$D" in *[a-zA-Z]*) T="";; *) T="tls internal";; esac
  cat > .env <<EOF
DOMAIN=$D
PUBLIC_IP=$P
CADDY_TLS=$T
DB_PASSWORD=$(r 24)
JWT_SECRET=$(r 48)
TURN_SECRET=$(r 32)
LK_KEY=API$(r 10)
LK_SECRET=$(r 40)
COMPOSE_PROFILES=restream,turn
APP_NAME=My Collation Center
COMMAND_PASSCODE=$(r 12)
PARTIES=APC,PDP,NNPP,ADC,NDC,LP,SDP,APGA,YPP,AA
STT_URL=
EOF
fi
docker compose up -d --build
echo; echo "Command Center:  https://$(grep ^DOMAIN= .env | cut -d= -f2)/command/"
echo "Command passcode: $(grep ^COMMAND_PASSCODE= .env | cut -d= -f2)"
