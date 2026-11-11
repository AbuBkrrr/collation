FROM node:26-alpine
# pg_dump (matching PostgreSQL 16) for the automatic on-PC backups; package name varies by Alpine version
RUN apk add --no-cache curl unzip wget su-exec && (apk add --no-cache postgresql16-client || apk add --no-cache postgresql-client)
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN sh scripts/get-vosk-model.sh || echo 'Vosk model download failed: offline speech disabled'
RUN chmod +x docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# starts as root, fixes data-dir ownership, then drops to the unprivileged "node" user
ENTRYPOINT ["sh","/app/docker-entrypoint.sh"]
CMD ["node","server.js"]
