FROM node:22-alpine
# postgresql16-client: pg_dump for the automatic backups on this PC
RUN apk add --no-cache postgresql16-client curl unzip
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN sh scripts/get-vosk-model.sh || echo 'Vosk model download failed: offline speech disabled'
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node","server.js"]
