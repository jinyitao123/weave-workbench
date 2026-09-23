# Container build for this ObjectStack app.
#
#   pnpm console94:build
#   docker buildx build --build-context console94=.generated/console94 -t my-app --load .
#   docker run -p 8080:8080 \
#     -e OS_DATABASE_URL="postgres://user:pass@db-host:5432/myapp" \
#     -e OS_AUTH_SECRET -e OS_SECRET_KEY \
#     my-app
#
# Or run the full app + Postgres stack: see docker-compose.yml.
# Docs: https://objectstack.ai/docs/deployment/self-hosting

# The runtime image's exact tag and registry digest are locked in console94.lock.json.
ARG OBJECTSTACK_RUNTIME_IMAGE=ghcr.io/objectstack-ai/objectstack:17.3.0@sha256:2b1f7efb8fcab00fd6b7cf741faa7ab6d75866d6b7b6e6b8b1bec69ce8f6e0ce

# ── Build stage: compile TypeScript metadata to the artifact ─────────
FROM node:24.19.0-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
COPY --from=console94 / /app/.console94/
RUN node scripts/inject-console94.mjs /app /app/.console94 /app/.generated/console94-layout.json
RUN pnpm exec objectstack build  # → dist/objectstack.json

# ── Runtime: the official ObjectStack runtime image ──────────────────
# Ships Node + @objectstack/cli with `os start`, a non-root user, the
# /api/v1/health HEALTHCHECK, and OS_ARTIFACT_PATH/OS_PORT preset (port 8080)
# — see the self-hosting guide linked above.
#
FROM nginx:1.30.5-alpine AS proxy
ARG FORGE_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="inoForge Nginx" \
      org.opencontainers.image.revision="${FORGE_SOURCE_REVISION}"
COPY transport/nginx.conf /etc/nginx/conf.d/default.conf

FROM ${OBJECTSTACK_RUNTIME_IMAGE} AS app
ARG OBJECTSTACK_RUNTIME_IMAGE
ARG CONSOLE_SOURCE_REVISION=unknown
ARG CONSOLE_TREE_SHA256=unknown
ARG FORGE_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="inoForge" \
      org.opencontainers.image.revision="${FORGE_SOURCE_REVISION}" \
      org.opencontainers.image.base.name="ghcr.io/objectstack-ai/objectstack:17.3.0" \
      org.opencontainers.image.base.digest="sha256:2b1f7efb8fcab00fd6b7cf741faa7ab6d75866d6b7b6e6b8b1bec69ce8f6e0ce" \
      org.opencontainers.image.console.source-revision="${CONSOLE_SOURCE_REVISION}" \
      org.opencontainers.image.console.tree-sha256="${CONSOLE_TREE_SHA256}"
RUN test "$OBJECTSTACK_RUNTIME_IMAGE" = "ghcr.io/objectstack-ai/objectstack:17.3.0@sha256:2b1f7efb8fcab00fd6b7cf741faa7ab6d75866d6b7b6e6b8b1bec69ce8f6e0ce" \
    || { echo "ObjectStack runtime image differs from the locked CLI-compatible digest." >&2; exit 1; }
WORKDIR /srv/app
USER root
RUN install -d -m 0750 -o node -g node /srv/app/.objectstack/data/uploads
USER node
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/objectstack.config.ts ./objectstack.config.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.console94/console94.lock.json /tmp/console94.lock.json
COPY --from=build --chown=node:node /app/.console94/console94-build.json /tmp/console94-build.json
COPY --from=build --chown=node:node /app/.generated/console94-layout.json /tmp/console94-layout.json
COPY --from=build --chown=node:node /app/scripts/console94-artifact.mjs /app/scripts/console94-runtime.mjs /app/scripts/verify-console94-runtime.mjs /tmp/
RUN node /tmp/verify-console94-runtime.mjs /srv/app /tmp/console94.lock.json /tmp/console94-build.json /tmp/console94-layout.json \
    && rm -f /tmp/console94.lock.json /tmp/console94-build.json /tmp/console94-layout.json /tmp/console94-artifact.mjs /tmp/console94-runtime.mjs /tmp/verify-console94-runtime.mjs

# The Forge app contains a small runtime plugin that exposes the authenticated
# Weave event ingress. Boot the authored config so this code is present; a pure
# objectstack.json boot can carry its metadata but cannot execute Plugin.init().
CMD ["node", "/srv/app/node_modules/@objectstack/cli/bin/run.js", "serve", "objectstack.config.ts"]

# OS_DATABASE_URL, OS_AUTH_SECRET, OS_SECRET_KEY, and
# FORGE_WEAVE_EVENT_SECRET are injected at runtime —
# never bake them into the image.
