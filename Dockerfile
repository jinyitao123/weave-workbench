ARG NODE_IMAGE=node:22-slim
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git musl-tools python3 ca-certificates
RUN npm install --global --no-audit --no-fund --registry="${NPM_REGISTRY}" pnpm@11.7.0
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=workbench-pnpm-store,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm --dir native/landlock-run build:ts && pnpm --dir native/landlock-run build:native
ARG DSH_CLIENT_COMMIT_HASH
ARG DSH_CLIENT_VERSION
RUN test -n "$DSH_CLIENT_COMMIT_HASH" && test -n "$DSH_CLIENT_VERSION" \
  && DSH_CLIENT_COMMIT_HASH="$DSH_CLIENT_COMMIT_HASH" DSH_CLIENT_VERSION="$DSH_CLIENT_VERSION" pnpm run build:workbench

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV DSH_HOME=/data/dsh
EXPOSE 3081
ENTRYPOINT ["node", "/app/apps/cli/lib/bin.js", "--profile", "workbench"]
CMD ["--host", "127.0.0.1", "--port", "3080", "--no-open"]
