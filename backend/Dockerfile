FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p storage/scorecards logs
EXPOSE 5000
USER node
CMD ["node", "src/server.js"]
