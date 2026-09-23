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

ARG OBJECTSTACK_RUNTIME_IMAGE=ghcr.io/objectstack-ai/objectstack:17.4.0

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
FROM nginx:1.30.5-alpine AS proxy
ARG FORGE_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="inoForge Nginx" \
      org.opencontainers.image.revision="${FORGE_SOURCE_REVISION}"
COPY transport/nginx.conf /etc/nginx/conf.d/default.conf

FROM ${OBJECTSTACK_RUNTIME_IMAGE} AS app
ARG FORGE_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="inoForge" \
      org.opencontainers.image.revision="${FORGE_SOURCE_REVISION}"
WORKDIR /srv/app
USER root
RUN install -d -m 0750 -o node -g node /srv/app/.objectstack/data/uploads
USER node
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/objectstack.config.ts ./objectstack.config.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist

# The Forge app contains a small runtime plugin that exposes the authenticated
# Weave event ingress. Boot the authored config so this code is present; a pure
# objectstack.json boot can carry its metadata but cannot execute Plugin.init().
CMD ["node", "/srv/app/node_modules/@objectstack/cli/bin/run.js", "serve", "objectstack.config.ts"]

# OS_DATABASE_URL, OS_AUTH_SECRET, OS_SECRET_KEY, and
# FORGE_WEAVE_EVENT_SECRET are injected at runtime —
# never bake them into the image.
