FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN apk add --no-cache curl unzip && sh scripts/get-vosk-model.sh || echo 'Vosk model download failed: offline speech disabled'
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","server.js"]
