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
    py3-pip py3-pillow py3-requests py3-flask \
    # Image processing libs (for Pillow/PIL)
    jpeg-dev libpng-dev libwebp-dev tiff-dev freetype-dev \
    # Headless browser
    chromium chromium-chromedriver \
    # Media processing
    ffmpeg \
    # General utilities
    curl openssh jq wget tar xz zip unzip \
    # Go language
    go

# Node.js build/test/lint tools (used by Claude when verifying implementations)
RUN npm i -g typescript tsx ts-node eslint prettier vite jest vitest \
    nodemon concurrently tsup

# Pre-warm npm cache with project dependencies so `npm install` is instant
RUN mkdir -p /tmp/warm-client /tmp/warm-server \
    && cd /tmp/warm-client \
    && printf '{"private":true,"dependencies":{"react":"^18.3.0","react-dom":"^18.3.0","react-router-dom":"^6.23.1","react-chartjs-2":"^5.3.0","chart.js":"^4.4.1","chartjs-adapter-date-fns":"^3.0.0","date-fns":"^3.6.0"},"devDependencies":{"@vitejs/plugin-react":"^4.3.0","vite":"^5.2.8"}}' > package.json \
    && npm install \
    && cd /tmp/warm-server \
    && printf '{"private":true,"dependencies":{"dotenv":"^16.4.0","express":"^4.19.0","sequelize":"^6.37.1","mysql2":"^3.10.0","cors":"^2.8.5"}}' > package.json \
    && npm install \
    && rm -rf /tmp/warm-client /tmp/warm-server

# Python build/test tools
RUN pip3 install --break-system-packages --no-cache-dir \
    pytest black flake8 mypy pyyaml beautifulsoup4 lxml mysql-connector-python selenium

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
    && cp -r /root/.npm /home/app/.npm \
    && chown -R 1000:1000 /home/app /data /app
USER 1000
ENV HOME=/home/app
ENV GOPATH=/home/app/go
ENV PATH="$GOPATH/bin:$PATH"

# Data directory for repos
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
