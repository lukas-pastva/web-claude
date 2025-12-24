# --- Shared build deps ---
FROM node:20-alpine AS build-base
RUN apk add --no-cache bash git g++ make python3 linux-headers

# --- Build frontend ---
FROM build-base AS fe
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* frontend/ .
RUN npm ci || npm i
COPY frontend/ .
RUN npm run build

# --- Build backend ---
FROM build-base AS be
WORKDIR /app
# Install backend deps in /app/backend
COPY backend/package.json backend/package-lock.json* ./backend/
RUN npm --prefix backend ci || npm --prefix backend i
# Copy backend sources
COPY backend/ ./backend
# Bring built FE into /app/frontend/dist (backend build copies it into dist/frontend)
COPY --from=fe /app/dist ./frontend/dist
# Build backend (produces /app/backend/dist/server.js and bundles frontend under dist/frontend)
RUN npm --prefix backend run build

# --- Runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Build deps for node-pty; shell tools; optional git; PHP CLI for Codex tasks
RUN apk add --no-cache bash git g++ make python3 linux-headers \
    && (apk add --no-cache php || apk add --no-cache php83 php83-cli)
# Optional: install Codex CLI if available in your registry
# If your Codex CLI package name differs, set CODEX_CMD accordingly
RUN npm i -g @openai/codex || true
COPY --from=be /app/backend/dist ./backend/dist
COPY backend/package.json backend/package-lock.json* ./backend/
RUN npm --prefix backend ci --omit=dev || npm --prefix backend i --omit=dev
# Data directory for repos
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
