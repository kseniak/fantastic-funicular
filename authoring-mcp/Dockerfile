# Minimal production image for the remote (HTTP) MCP server.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Hosts inject PORT; the server reads process.env.PORT (defaults to 3000).
EXPOSE 3000
CMD ["node", "dist/http.js"]
