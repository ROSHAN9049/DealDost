FROM node:22-alpine
WORKDIR /app
COPY engine/package.json ./package.json
COPY engine/worker.mjs ./worker.mjs
CMD ["node","worker.mjs"]
