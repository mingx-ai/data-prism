FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY . .
RUN npm run build:selfhost
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist-selfhost ./dist-selfhost
ENV NODE_ENV=production PORT=3000 PRISM_WEB_BIND=0.0.0.0 PRISM_WEB_DATA=/data PRISM_MIGRATIONS=/app/dist-selfhost/drizzle
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node","dist-selfhost/server.mjs"]
