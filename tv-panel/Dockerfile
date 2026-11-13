FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json *.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /var/tv-data && chown node:node /var/tv-data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TVHOSP_DATA_DIR=/var/tv-data FFMPEG_PATH=/usr/bin/ffmpeg
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
