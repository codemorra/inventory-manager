FROM node:24-bookworm-slim AS node-base

FROM node-base AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY package.json /build/package.json
COPY scripts/generate-app-version.mjs /build/scripts/generate-app-version.mjs
COPY LICENSE /build/LICENSE
COPY assets/icons/app-logo.svg /build/assets/icons/app-logo.svg
COPY frontend/ ./
ENV VITE_API_BASE_URL=/api
RUN npm run build

FROM node-base AS backend-dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM backend-dependencies AS backend-build
COPY package.json /build/package.json
COPY scripts/generate-app-version.mjs /build/scripts/generate-app-version.mjs
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npm run build

FROM backend-dependencies AS backend-production-dependencies
RUN npm prune --omit=dev

FROM node-base AS runtime
WORKDIR /app/backend
COPY --from=backend-build /build/backend/dist/ ./dist/
COPY --from=backend-production-dependencies /build/backend/node_modules/ ./node_modules/
COPY backend/package.json ./package.json
COPY backend/drizzle/ ./drizzle/
COPY --from=frontend-build /build/frontend/dist/ /app/frontend/dist/
COPY LICENSE /app/LICENSE
RUN groupadd --gid 10001 inventory-manager \
    && useradd --uid 10001 --gid 10001 --create-home \
        --home-dir /home/inventory-manager --shell /usr/sbin/nologin inventory-manager \
    && install -d -o 10001 -g 10001 -m 0755 /app/InventoryData
ENV NODE_ENV=production \
    INVENTORY_HOST=0.0.0.0 \
    INVENTORY_PORT=8000 \
    INVENTORY_DATA_DIR=/app/InventoryData \
    INVENTORY_FRONTEND_DIR=/app/frontend/dist
USER 10001:10001
EXPOSE 8000
CMD ["node", "dist/index.js"]
