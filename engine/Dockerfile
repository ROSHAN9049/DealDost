FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY worker.mjs ./

ENV NODE_ENV=production
ENV TRADING_MODE=PAPER

CMD ["node", "worker.mjs"]
