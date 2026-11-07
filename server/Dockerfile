FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
