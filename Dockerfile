FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

VOLUME ["/app/data"]
CMD ["node", "src/index.js"]
