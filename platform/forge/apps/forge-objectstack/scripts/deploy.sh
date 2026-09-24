#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "缺少 $APP_DIR/.env，无法部署。" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker。" >&2
  exit 1
fi
if ! docker buildx version >/dev/null 2>&1; then
  echo "部署需要 Docker Buildx，以传入已验证的 Console 94 构建上下文。" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1 || ! command -v gzip >/dev/null 2>&1; then
  echo "部署需要 curl 和 gzip。" >&2
  exit 1
fi

CONSOLE_BUILD_CONTEXT=${FORGE_CONSOLE_BUILD_CONTEXT:-.generated/console94}
case "$CONSOLE_BUILD_CONTEXT" in
  /*) ;;
  *) CONSOLE_BUILD_CONTEXT="$APP_DIR/$CONSOLE_BUILD_CONTEXT" ;;
esac
CONSOLE_BUILD_ENV="$CONSOLE_BUILD_CONTEXT/console94-build.env"
if [ ! -f "$CONSOLE_BUILD_CONTEXT/console94.lock.json" ] || [ ! -f "$CONSOLE_BUILD_CONTEXT/console94-build.json" ] || [ ! -f "$CONSOLE_BUILD_CONTEXT/dist/index.html" ] || [ ! -f "$CONSOLE_BUILD_ENV" ]; then
  echo "缺少 Console 94 固定构建上下文。先按 apps/forge-objectstack/README.md 构建并验证 Console。" >&2
  exit 1
fi
console_context_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$CONSOLE_BUILD_ENV"
}
CONSOLE_SOURCE_REVISION=$(console_context_value source_revision)
CONSOLE_TREE_SHA256=$(console_context_value tree_sha256)
if [ "${#CONSOLE_SOURCE_REVISION}" -ne 40 ] || [ "${#CONSOLE_TREE_SHA256}" -ne 64 ]; then
  echo "Console 94 构建上下文缺少有效源码修订或产物摘要。" >&2
  exit 1
fi
case "$CONSOLE_SOURCE_REVISION$CONSOLE_TREE_SHA256" in
  *[!0-9a-f]*) echo "Console 94 构建上下文包含无效摘要。" >&2; exit 1 ;;
esac

# Read only numeric, non-secret settings from Compose's .env without sourcing
# it as shell code. Compose itself remains responsible for secret expansion.
compose_env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' .env \
    | sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

HTTP_PORT=${FORGE_HTTP_PORT:-$(compose_env_value FORGE_HTTP_PORT)}
HTTP_PORT=${HTTP_PORT:-8080}
CANDIDATE_PORT=${FORGE_CANDIDATE_PORT:-$(compose_env_value FORGE_CANDIDATE_PORT)}
CANDIDATE_PORT=${CANDIDATE_PORT:-14612}
case "$HTTP_PORT:$CANDIDATE_PORT" in
  *[!0-9:]*|:*|*:) echo "FORGE_HTTP_PORT 和 FORGE_CANDIDATE_PORT 必须是数字端口。" >&2; exit 1 ;;
esac
if [ "$HTTP_PORT" = "$CANDIDATE_PORT" ]; then
  echo "候选端口必须与公网端口不同。" >&2
  exit 1
fi
for checked_port in "$HTTP_PORT" "$CANDIDATE_PORT"; do
  if [ "$checked_port" -lt 1 ] || [ "$checked_port" -gt 65535 ]; then
    echo "HTTP 端口范围必须在 1 到 65535 之间。" >&2
    exit 1
  fi
done

SOURCE_REVISION=${FORGE_SOURCE_REVISION:-}
if [ -z "$SOURCE_REVISION" ]; then
  if ! command -v git >/dev/null 2>&1 || ! SOURCE_REVISION=$(git rev-parse HEAD 2>/dev/null); then
    echo "无法识别源码提交，请设置 FORGE_SOURCE_REVISION。" >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "当前存在未提交或未跟踪的文件，拒绝生成不可追踪的发布镜像。" >&2
    exit 1
  fi
fi

case "$SOURCE_REVISION" in
  *[!0-9a-fA-F]*)
    echo "FORGE_SOURCE_REVISION 必须是 Git 提交哈希。" >&2
    exit 1
    ;;
esac
if [ "${#SOURCE_REVISION}" -lt 7 ]; then
  echo "FORGE_SOURCE_REVISION 至少需要 7 位。" >&2
  exit 1
fi
SOURCE_REVISION=$(printf '%s' "$SOURCE_REVISION" | tr 'A-F' 'a-f')

IMAGE_TAG=$(printf '%s' "$SOURCE_REVISION" | cut -c1-12)
IMAGE_REPOSITORY=${FORGE_IMAGE_REPOSITORY:-inoforge-app}
PROXY_REPOSITORY=${FORGE_PROXY_IMAGE_REPOSITORY:-inoforge-proxy}
IMAGE="$IMAGE_REPOSITORY:sha-$IMAGE_TAG"
PROXY_IMAGE="$PROXY_REPOSITORY:sha-$IMAGE_TAG"
RELEASE_ROOT=${FORGE_RELEASE_DIR:-$APP_DIR/.deploy}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE_DIR="$RELEASE_ROOT/releases/$RELEASE_ID"
BACKUP_DIR="$RELEASE_ROOT/backups/$RELEASE_ID"
if [ -e "$RELEASE_DIR" ] || [ -e "$BACKUP_DIR" ]; then
  RELEASE_ID="$RELEASE_ID-$$"
  RELEASE_DIR="$RELEASE_ROOT/releases/$RELEASE_ID"
  BACKUP_DIR="$RELEASE_ROOT/backups/$RELEASE_ID"
fi
mkdir -p "$RELEASE_DIR" "$BACKUP_DIR"

PREVIOUS_CONTAINER=$(docker compose ps -q app 2>/dev/null || true)
PREVIOUS_IMAGE=""
PREVIOUS_IMAGE_ID=""
if [ -n "$PREVIOUS_CONTAINER" ]; then
  PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$PREVIOUS_CONTAINER" 2>/dev/null || true)
  PREVIOUS_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$PREVIOUS_CONTAINER" 2>/dev/null || true)
fi

PREVIOUS_PROXY_CONTAINER=$(docker compose ps -q proxy 2>/dev/null || true)
PREVIOUS_PROXY_IMAGE=""
PREVIOUS_PROXY_IMAGE_ID=""
if [ -n "$PREVIOUS_PROXY_CONTAINER" ]; then
  PREVIOUS_PROXY_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$PREVIOUS_PROXY_CONTAINER" 2>/dev/null || true)
  PREVIOUS_PROXY_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$PREVIOUS_PROXY_CONTAINER" 2>/dev/null || true)
fi

DB_CONTAINER=$(docker compose ps -q db 2>/dev/null || true)
BACKUP_PATH=""
if [ -n "$DB_CONTAINER" ]; then
  BACKUP_PATH="$BACKUP_DIR/database.sql.gz"
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$BACKUP_PATH"
  gzip -t "$BACKUP_PATH"
  echo "数据库备份完成：$BACKUP_PATH"
else
  echo "未发现已运行数据库，按首次部署继续。"
fi

echo "构建 Forge 镜像：$IMAGE"
BUILDX_GIT_INFO=false docker buildx build \
  --progress=plain \
  --target app \
  --build-context "console94=$CONSOLE_BUILD_CONTEXT" \
  --build-arg "FORGE_SOURCE_REVISION=$SOURCE_REVISION" \
  --build-arg "CONSOLE_SOURCE_REVISION=$CONSOLE_SOURCE_REVISION" \
  --build-arg "CONSOLE_TREE_SHA256=$CONSOLE_TREE_SHA256" \
  --tag "$IMAGE" \
  --load \
  .

echo "构建 Nginx 入口镜像：$PROXY_IMAGE"
BUILDX_GIT_INFO=false docker buildx build \
  --progress=plain \
  --target proxy \
  --build-context "console94=$CONSOLE_BUILD_CONTEXT" \
  --build-arg "FORGE_SOURCE_REVISION=$SOURCE_REVISION" \
  --tag "$PROXY_IMAGE" \
  --load \
  .

FORGE_HEALTH_ATTEMPTS=${FORGE_HEALTH_ATTEMPTS:-60}
case "$FORGE_HEALTH_ATTEMPTS" in
  *[!0-9]*|"") echo "FORGE_HEALTH_ATTEMPTS 必须是正整数。" >&2; exit 1 ;;
esac
if [ "$FORGE_HEALTH_ATTEMPTS" -lt 1 ]; then
  echo "FORGE_HEALTH_ATTEMPTS 必须大于零。" >&2
  exit 1
fi

CANDIDATE_HEALTH_URL=${FORGE_CANDIDATE_HEALTH_URL:-http://127.0.0.1:$CANDIDATE_PORT/api/v1/health}
PUBLIC_HEALTH_URL=${FORGE_HEALTH_URL:-http://127.0.0.1:$HTTP_PORT/api/v1/health}
CANDIDATE_STARTED=0

cleanup_candidate() {
  if [ "$CANDIDATE_STARTED" -eq 1 ]; then
    FORGE_CANDIDATE_PORT="$CANDIDATE_PORT" docker compose --profile transport-candidate rm -f -s proxy-candidate >/dev/null 2>&1 || true
    CANDIDATE_STARTED=0
  fi
}
trap cleanup_candidate EXIT

wait_for_url() {
  wait_url=$1
  wait_label=$2
  wait_attempt=1
  while [ "$wait_attempt" -le "$FORGE_HEALTH_ATTEMPTS" ]; do
    if curl --fail --silent "$wait_url" >/dev/null 2>&1; then
      echo "${wait_label}通过。"
      return 0
    fi
    sleep 2
    wait_attempt=$((wait_attempt + 1))
  done
  return 1
}

wait_for_app_container() {
  wait_attempt=1
  while [ "$wait_attempt" -le "$FORGE_HEALTH_ATTEMPTS" ]; do
    wait_container=$(docker compose ps -q app 2>/dev/null || true)
    if [ -n "$wait_container" ]; then
      wait_state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$wait_container" 2>/dev/null || true)
      case "$wait_state" in
        healthy) return 0 ;;
        unhealthy) return 1 ;;
      esac
    fi
    sleep 2
    wait_attempt=$((wait_attempt + 1))
  done
  return 1
}

rollback_previous() {
  if [ -z "$PREVIOUS_IMAGE" ]; then
    echo "没有可恢复的上一应用镜像。" >&2
    return 1
  fi

  echo "恢复上一应用镜像：$PREVIOUS_IMAGE" >&2
  if [ -n "$PREVIOUS_PROXY_IMAGE" ]; then
    if ! FORGE_IMAGE="$PREVIOUS_IMAGE" docker compose up -d --no-build --no-deps --force-recreate app; then
      echo "恢复上一应用容器失败。" >&2
      return 1
    fi
    if ! wait_for_app_container; then
      echo "上一应用镜像未通过容器健康检查。" >&2
      return 1
    fi
    if ! FORGE_PROXY_IMAGE="$PREVIOUS_PROXY_IMAGE" docker compose up -d --no-build --no-deps --force-recreate proxy; then
      echo "恢复上一代理容器失败。" >&2
      return 1
    fi
    if ! wait_for_url "http://127.0.0.1:$HTTP_PORT/api/v1/health" "上一版本公网入口健康检查"; then
      echo "上一代理与应用组合未恢复公网健康。" >&2
      return 1
    fi
    return 0
  fi

  # First proxy adoption can still return to the previous direct-app port if
  # the candidate was good but activation fails. This one-off override is
  # stored with the release evidence; it contains no secrets.
  echo "首次切换失败，恢复上一版直连端口：$HTTP_PORT" >&2
  docker compose stop proxy >/dev/null 2>&1 || true
  cleanup_candidate
  ROLLBACK_OVERRIDE="$RELEASE_DIR/rollback-compose.yml"
  cat > "$ROLLBACK_OVERRIDE" <<EOF
services:
  app:
    ports:
      - "$HTTP_PORT:8080"
EOF
  if ! FORGE_IMAGE="$PREVIOUS_IMAGE" docker compose -f docker-compose.yml -f "$ROLLBACK_OVERRIDE" up -d --no-build --no-deps --force-recreate app; then
    echo "恢复旧版直连应用失败。" >&2
    return 1
  fi
  if ! wait_for_url "http://127.0.0.1:$HTTP_PORT/api/v1/health" "上一版本直连健康检查"; then
    echo "上一版应用未恢复公网健康。" >&2
    return 1
  fi
  return 0
}

# A fresh installation has no upstream for Nginx yet. Boot the app (whose
# entrypoint completes schema preflight before serving) before probing a proxy.
if [ -z "$PREVIOUS_CONTAINER" ]; then
  echo "首次部署：初始化数据库与 Forge 应用。"
  if ! FORGE_IMAGE="$IMAGE" docker compose up -d --no-build app || ! wait_for_app_container; then
    echo "首次初始化未通过；公网入口未启用。" >&2
    exit 1
  fi
fi

# Validate the proxy on a loopback-only port before switching the public entry.
echo "启动候选 Nginx，端口：$CANDIDATE_PORT"
CANDIDATE_STARTED=1
if ! FORGE_PROXY_IMAGE="$PROXY_IMAGE" FORGE_CANDIDATE_PORT="$CANDIDATE_PORT" \
  docker compose --profile transport-candidate up -d --no-build --no-deps --force-recreate proxy-candidate; then
  echo "候选 Nginx 启动失败；现有公网入口未切换。" >&2
  exit 1
fi
if ! wait_for_url "$CANDIDATE_HEALTH_URL" "候选 Nginx / Forge 健康检查"; then
  echo "候选 Nginx 未能经 Forge 健康检查；现有公网入口未切换。" >&2
  exit 1
fi

echo "切换 Forge 应用镜像：$IMAGE"
if ! FORGE_IMAGE="$IMAGE" docker compose up -d --no-build app; then
  echo "新应用容器启动失败，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi
if ! wait_for_app_container; then
  echo "新应用容器未通过健康检查，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi

# Recreate the candidate to resolve the app service's current Compose address,
# then validate the new app before the stable public port is promoted.
if ! FORGE_PROXY_IMAGE="$PROXY_IMAGE" FORGE_CANDIDATE_PORT="$CANDIDATE_PORT" \
  docker compose --profile transport-candidate up -d --no-build --no-deps --force-recreate proxy-candidate; then
  echo "候选 Nginx 刷新失败，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi
if ! wait_for_url "$CANDIDATE_HEALTH_URL" "候选 Nginx / 新 Forge 健康检查"; then
  echo "新 Forge 未能经候选 Nginx 健康检查，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi

echo "切换公网入口至 Nginx，端口：$HTTP_PORT"
if ! FORGE_PROXY_IMAGE="$PROXY_IMAGE" docker compose up -d --no-build --no-deps --force-recreate proxy; then
  echo "公网 Nginx 启动失败，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi
if ! wait_for_url "$PUBLIC_HEALTH_URL" "公网 Nginx / Forge 健康检查"; then
  echo "公网入口健康检查失败，开始恢复。" >&2
  rollback_previous || true
  exit 1
fi

IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE")
PROXY_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$PROXY_IMAGE")
{
  printf 'released_at=%s\n' "$RELEASE_ID"
  printf 'source_revision=%s\n' "$SOURCE_REVISION"
  printf 'console_source_revision=%s\n' "$CONSOLE_SOURCE_REVISION"
  printf 'console_tree_sha256=%s\n' "$CONSOLE_TREE_SHA256"
  printf 'app_image=%s\n' "$IMAGE"
  printf 'app_image_id=%s\n' "$IMAGE_ID"
  printf 'proxy_image=%s\n' "$PROXY_IMAGE"
  printf 'proxy_image_id=%s\n' "$PROXY_IMAGE_ID"
  printf 'previous_app_image=%s\n' "$PREVIOUS_IMAGE"
  printf 'previous_app_image_id=%s\n' "$PREVIOUS_IMAGE_ID"
  printf 'previous_proxy_image=%s\n' "$PREVIOUS_PROXY_IMAGE"
  printf 'previous_proxy_image_id=%s\n' "$PREVIOUS_PROXY_IMAGE_ID"
  printf 'public_http_port=%s\n' "$HTTP_PORT"
  printf 'candidate_http_port=%s\n' "$CANDIDATE_PORT"
  printf 'health_path=/api/v1/health\n'
  printf 'database_backup=%s\n' "$BACKUP_PATH"
} > "$RELEASE_DIR/release.env"

cleanup_candidate
echo "部署完成：$IMAGE，经 Nginx 端口 $HTTP_PORT 提供服务。"
echo "发布记录：$RELEASE_DIR/release.env"
