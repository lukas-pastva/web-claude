# web-codex

All‑in‑one web UI to browse your GitHub/GitLab repos, pull/branch/commit/push, and work via the Codex CLI in the container. No web login or AI instruction area — CLI‑only.

## Features

- Tabs grouped by **GitHub user/orgs** and **GitLab groups**.
- One‑click `git pull`, **branch** dropdown + checkout.
- Built‑in terminal running your configured `CODEX_CMD` (always visible once a repo is open).
- **Commit history**: shows the latest commit by default; click + to reveal more (10 at a time). Includes a “copy hash” action.

## Quick Start (Docker)

```bash
# Build (use the Dockerfile in src/ with src/ as context)
docker build -f src/Dockerfile -t web-codex:0.1.0 src

# Run (map port and data volume). Provide tokens via env or secrets.
docker run --rm -p 8080:8080 \
  -e GH_TOKEN=ghp_... -e GH_USER=your-username -e GH_ORGS=org1,org2 \
  -e GL_TOKEN=glpat-... -e GL_BASE_URL=https://gitlab.com -e GL_GROUPS=groupA,groupB \
  -e CODEX_CMD=codex -e HOME=/home/app \
  -v $(pwd)/data:/data \
  web-codex:0.1.0
```

Open http://localhost:8080

## Kubernetes (CLI‑only, secrets‑backed)

Example Deployment (uses a Secret for tokens and Codex config):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app.kubernetes.io/name: web-codex
  name: web-codex
  namespace: web-codex
spec:
  replicas: 1
  revisionHistoryLimit: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: web-codex
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web-codex
    spec:
      containers:
        - env:
            - name: GH_TOKEN
              valueFrom:
                secretKeyRef:
                  key: GH_TOKEN
                  name: web-codex
            - name: GH_USER
              value: your-github-user
            - name: GL_TOKEN
              valueFrom:
                secretKeyRef:
                  key: GL_TOKEN
                  name: web-codex
            - name: GL_GROUPS
              value: '12345'
            - name: DEBUG
              value: '1'
            - name: CODEX_CMD
              value: codex
            - name: HOME
              value: /home/app
          image: yourregistry/web-codex:tag
          imagePullPolicy: Always
          name: web-codex
          ports:
            - containerPort: 8080
              name: http
              protocol: TCP
          resources:
            limits:
              memory: 500Mi
            requests:
              cpu: 250m
              memory: 250Mi
          securityContext:
            fsGroup: 1000
            runAsGroup: 1000
            runAsNonRoot: true
            runAsUser: 1000
          volumeMounts:
            - mountPath: /home/app/.codex
              name: codex-writable
              subPath: .codex
            - mountPath: /data
              name: data
      initContainers:
        - command:
            - /bin/sh
            - '-c'
            - |
              set -euo pipefail
              mkdir -p /work/.codex
              cp /bootstrap/auth.json /work/.codex/auth.json
              cp /bootstrap/config.toml /work/.codex/config.toml
              chown -R 1000:1000 /work/.codex
              chmod 700 /work/.codex
              chmod 600 /work/.codex/auth.json /work/.codex/config.toml
              mkdir -p /data/repos/_tmp
              chown -R 1000:1000 /data
          image: alpine:3.20
          name: setup-codex-config
          volumeMounts:
            - mountPath: /bootstrap
              name: secret-bootstrap
              readOnly: true
            - mountPath: /work
              name: codex-writable
            - mountPath: /data
              name: data
      serviceAccountName: web-codex
      volumes:
        - name: secret-bootstrap
          secret:
            items:
              - key: auth.json
                path: auth.json
              - key: config.toml
                path: config.toml
            secretName: web-codex
        - emptyDir: {}
          name: codex-writable
        - emptyDir: {}
          name: data
```

Security note: provide Git tokens via Secret/env and avoid verbose logs in production.

## Workflow

1. Open the app and choose a provider tab (GitHub user/org or GitLab group).
2. Click a repo row to clone/open it.
3. The terminal is always visible for CLI usage (`CODEX_CMD`).
4. Use the actions row to pull/checkout/commit/push.
5. Diff preview auto‑refreshes by default; adjust interval as needed.

## Environment Variables

- `PORT` — HTTP listen port. Default: `8080`.
- `DATA_DIR` — Root for repository storage. Default: `/data/repos`. Mount `/data` to persist.

- Debugging:
  - `DEBUG` — set to `1`, `true`, or `debug` to enable verbose backend logs (Axios request URLs, per‑provider errors, clone details). Sensitive tokens are redacted in logs.

- GitHub:
  - `GH_TOKEN` — Personal access token. Required to list repos and push.
  - `GH_USER` — Target GitHub username. If omitted, uses the token’s identity.
    - Only repositories OWNED by `GH_USER` are listed under that tab.
    - If `GH_USER` ≠ token identity, only public repos can be listed (GitHub API limitation).
  - `GH_ORGS` — Comma‑separated orgs to show (e.g., `org1,org2`). Optional; lists repositories in each org.

- GitLab:
  - `GL_TOKEN` — Personal access token. Required to list group projects and push.
  - `GL_BASE_URL` — Base URL of your GitLab instance. Default: `https://gitlab.com`.
  - `GL_GROUPS` — Comma‑separated group IDs or full paths (e.g., `12345`, `mygroup/subgroup`).

- Codex CLI:
  - `CODEX_CMD` — Command executed in the in‑browser terminal. Default: `codex`.

- Git identity for commits (optional; backend falls back to sensible defaults):
  - `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME` — author/committer name used for `git commit`.
  - `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL` — author/committer email.
  - If unset, backend uses `GH_USER` and `${GH_USER}@users.noreply.github.com` when available.

## Dev

```bash
cd src
npm i
npm run dev
# FE: http://localhost:5173  | BE: http://localhost:8080
```

The backend dev server loads environment variables from `src/backend/.env` (via `node --env-file=.env`). Create that file to customize your local run, for example:

```ini
# src/backend/.env
PORT=8080
DATA_DIR=/data/repos
GH_TOKEN=ghp_...
GH_USER=your-username
GH_ORGS=org1,org2
GL_TOKEN=glpat-...
GL_BASE_URL=https://gitlab.com
GL_GROUPS=mygroup
# Debugging
DEBUG=1
# CLI
CODEX_CMD=codex
# Optional: commit identity
GIT_AUTHOR_NAME=web-codex
GIT_AUTHOR_EMAIL=web-codex@example.invalid
```

## Caveats / Next steps

- Provide **file selection** and **larger context** per patch.
- Add **branch create** PR/MR helpers.
- Stream patches; show **git status**; per‑repo settings.
- Token storage: env vars – integrate a vault for prod.

## License

MIT

## Codex CLI

The terminal auto‑opens when you open a repo and runs `CODEX_CMD` (default `codex`) in that repo. Provide Codex auth/config via a mounted Secret (see the Deployment example) — no web login is needed.

## Health checks (Kubernetes)
- **/healthz** — liveness probe
- **/readyz** — readiness probe (verifies /data is writable)
The deployment already includes HTTP probes for both endpoints.

## Auto-refresh diff
In the repo view, toggle **Auto refresh** to periodically update the working‑tree diff and status.
You can set the refresh interval (default 5s; minimum 2s).

psw 2025
bump