# Container build for this ObjectStack app.
#
#   docker build -t my-app .
#   docker run -p 8080:8080 \
#     -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
#     -e OS_AUTH_SECRET -e OS_SECRET_KEY \
#     my-app
#
# Or run the full app + Postgres stack: see docker-compose.yml.
# Docs: https://objectstack.ai/docs/deployment/self-hosting

# ── Build stage: compile TypeScript metadata to the artifact ─────────
FROM node:24.19.0-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec objectstack build  # → dist/objectstack.json

# ── Runtime: the official ObjectStack runtime image ──────────────────
# Ships Node + @objectstack/cli with `os start`, a non-root user, the
# /api/v1/health HEALTHCHECK, and OS_ARTIFACT_PATH/OS_PORT preset (port 8080)
# — see the self-hosting guide linked above.
#
# Dependencies were not installed while scaffolding, so the tag below could
# not be resolved for you. `latest` floats to whatever release is newest,
# which is unrelated to the @objectstack/cli your app resolves — pin it to
# that version, the CLI that builds your artifact, before you deploy.
FROM ghcr.io/objectstack-ai/objectstack:17.4.0
COPY --from=build --chown=node:node /app/dist/objectstack.json /srv/app/objectstack.json

# OS_DATABASE_URL, OS_AUTH_SECRET, and OS_SECRET_KEY are injected at runtime —
# never bake them into the image.
