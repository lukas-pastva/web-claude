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
# Build deps for node-pty; shell tools; git
RUN apk add --no-cache bash git g++ make python3 linux-headers

# Install Claude CLI globally
RUN npm i -g @anthropic-ai/claude-code

# Copy backend build
COPY --from=be /app/backend/dist ./backend/dist
COPY backend/package.json backend/package-lock.json* ./backend/
RUN npm --prefix backend ci --omit=dev || npm --prefix backend i --omit=dev

# Set up directories for the existing node user (uid 1000)
RUN mkdir -p /home/node/.claude /data/repos && chown -R node:node /home/node /data /app
USER node
ENV HOME=/home/node

# Data directory for repos
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
