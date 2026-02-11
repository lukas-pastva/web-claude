#!/bin/bash
set -e

# Auto-login to GitHub CLI if GH_TOKEN is set
if [ -n "$GH_TOKEN" ]; then
    echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
fi

# Auto-login to GitLab CLI if GITLAB_TOKEN is set
if [ -n "$GITLAB_TOKEN" ]; then
    # GITLAB_HOST defaults to gitlab.com if not set
    glab auth login --token "$GITLAB_TOKEN" --hostname "${GITLAB_HOST:-gitlab.com}" 2>/dev/null || true
fi

exec "$@"
