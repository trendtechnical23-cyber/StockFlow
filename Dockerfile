FROM node:20-alpine

WORKDIR /app

# Copy server package files and install production deps only
COPY server/package*.json ./
RUN npm install --omit=dev

# Copy server source
COPY server/ .

EXPOSE 4000

CMD ["node", "server.js"]
