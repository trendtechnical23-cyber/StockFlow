FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ .

# Railway injects PORT at runtime — do not hardcode it
ENV NODE_ENV=production

CMD ["node", "server.js"]
