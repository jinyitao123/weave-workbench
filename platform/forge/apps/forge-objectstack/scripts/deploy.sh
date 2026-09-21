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

SOURCE_REVISION=${FORGE_SOURCE_REVISION:-}
if [ -z "$SOURCE_REVISION" ]; then
  if ! command -v git >/dev/null 2>&1 || ! SOURCE_REVISION=$(git rev-parse HEAD 2>/dev/null); then
    echo "无法识别源码提交，请设置 FORGE_SOURCE_REVISION。" >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "当前存在未提交的受控文件，拒绝生成不可追踪的发布镜像。" >&2
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

IMAGE_REPOSITORY=${FORGE_IMAGE_REPOSITORY:-inoforge-app}
IMAGE_TAG=$(printf '%s' "$SOURCE_REVISION" | cut -c1-12)
IMAGE="$IMAGE_REPOSITORY:sha-$IMAGE_TAG"
RELEASE_ROOT=${FORGE_RELEASE_DIR:-$APP_DIR/.deploy}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
RELEASE_DIR="$RELEASE_ROOT/releases/$RELEASE_ID"
BACKUP_DIR="$RELEASE_ROOT/backups/$RELEASE_ID"
mkdir -p "$RELEASE_DIR" "$BACKUP_DIR"

PREVIOUS_CONTAINER=$(docker compose ps -q app 2>/dev/null || true)
PREVIOUS_IMAGE=""
if [ -n "$PREVIOUS_CONTAINER" ]; then
  PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$PREVIOUS_CONTAINER" 2>/dev/null || true)
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
BUILDX_GIT_INFO=false docker build \
  --progress=plain \
  --build-arg "FORGE_SOURCE_REVISION=$SOURCE_REVISION" \
  --tag "$IMAGE" \
  .

FORGE_IMAGE="$IMAGE" docker compose up -d --no-build app

HTTP_PORT=${FORGE_HTTP_PORT:-}
if [ -z "$HTTP_PORT" ]; then
  HTTP_PORT=$(docker compose port app 8080 | sed -n '1s/.*://p')
fi
HTTP_PORT=${HTTP_PORT:-8080}
HEALTH_URL=${FORGE_HEALTH_URL:-http://127.0.0.1:$HTTP_PORT/api/v1/health}
HEALTHY=0
ATTEMPT=1
while [ "$ATTEMPT" -le 30 ]; do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
  ATTEMPT=$((ATTEMPT + 1))
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "新版本健康检查失败：$HEALTH_URL" >&2
  if [ -n "$PREVIOUS_IMAGE" ]; then
    echo "恢复上一镜像：$PREVIOUS_IMAGE" >&2
    FORGE_IMAGE="$PREVIOUS_IMAGE" docker compose up -d --no-build app
  fi
  exit 1
fi

IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE")
{
  printf 'released_at=%s\n' "$RELEASE_ID"
  printf 'source_revision=%s\n' "$SOURCE_REVISION"
  printf 'image=%s\n' "$IMAGE"
  printf 'image_id=%s\n' "$IMAGE_ID"
  printf 'previous_image=%s\n' "$PREVIOUS_IMAGE"
  printf 'database_backup=%s\n' "$BACKUP_PATH"
  printf 'health_url=%s\n' "$HEALTH_URL"
} > "$RELEASE_DIR/release.env"

echo "部署完成：$IMAGE"
echo "发布记录：$RELEASE_DIR/release.env"
