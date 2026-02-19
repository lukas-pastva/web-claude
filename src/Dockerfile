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
# Build deps for node-pty; shell tools; git; GitHub CLI; GitLab CLI
RUN apk add --no-cache bash git g++ make python3 linux-headers github-cli glab \
    # Python pip & common libs
    py3-pip py3-pillow py3-requests py3-flask py3-selenium \
    # Image processing libs (for Pillow/PIL)
    jpeg-dev libpng-dev libwebp-dev tiff-dev freetype-dev \
    # Headless browser
    chromium chromium-chromedriver \
    # Media processing
    ffmpeg \
    # General utilities
    curl openssh jq wget tar xz zip unzip

# Node.js build/test/lint tools (used by Claude when verifying implementations)
RUN npm i -g typescript tsx ts-node eslint prettier vite jest vitest \
    npx nodemon concurrently tsup

# Python build/test tools
RUN pip3 install --break-system-packages --no-cache-dir \
    pytest black flake8 mypy pyyaml beautifulsoup4 lxml mysql-connector-python

# Install Claude CLI globally
RUN npm i -g @anthropic-ai/claude-code

# Copy backend build
COPY --from=be /app/backend/dist ./backend/dist
COPY backend/package.json backend/package-lock.json* ./backend/
RUN npm --prefix backend ci --omit=dev || npm --prefix backend i --omit=dev

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create app user with home at /home/app (uid 1000 matches K8s securityContext)
RUN mkdir -p /home/app/.claude /data/repos \
    && chown -R 1000:1000 /home/app /data /app
USER 1000
ENV HOME=/home/app

# Data directory for repos
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
