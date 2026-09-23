# Forge ObjectStack

当前这里仍集中注册一个 Forge 应用，七应用及各自设置的拆分尚待实施；包含业务对象、动作、运行时 hooks 和 Console 页面。入口为 [objectstack.config.ts](objectstack.config.ts)，依赖版本和可执行命令以 [package.json](package.json) 为准；不在说明中手工维护容易过时的对象、字段或页面总数。

业务范围、质量要求与当前资料入口见[项目首页](../../README.md)、[项目规则](../../AGENTS.md)和[文档索引](../../docs/README.md)。

## 本地开发

在本目录执行：

```sh
pnpm install
pnpm dev --help
pnpm dev
```

先为当前任务选择未占用的独立端口与独立 SQLite，再启动开发服务；实际 Console/API 地址和持久库位置以启动配置及日志为准。不要照抄旧报告的端口或数据库路径，也不要为验证文档修改重启正在使用的服务。

`pnpm dev` 是 package.json 定义的开发入口，不代表已有环境已启动、已登录或数据已准备。登录使用当前测试环境配置，本文件不维护账号密码。验收脚本须显式设置指向本任务环境的 `FORGE_URL`，不得借用主线环境证明分支通过。

## 代码入口

| 路径 | 职责 |
| --- | --- |
| [objectstack.config.ts](objectstack.config.ts) | 元数据注册与 Console 导航 |
| [src/objects](src/objects) | 业务对象 |
| [src/actions](src/actions) | 业务动作 |
| [src/hooks](src/hooks) | 运行时 hooks |
| [src/pages](src/pages) | 自定义业务页与共享 product-ui |
| [tests](tests) | 静态检查、业务验收与重启回读脚本 |

## 修改与验证

每次元数据修改后执行：

```sh
pnpm typecheck
pnpm validate
pnpm build
```

再执行对应业务链的验收脚本。涉及持久状态时，使用同一持久数据库完整停服重启回读；页面与业务验收遵循 Forge 合同、实际角色操作和独立读回，外部参考对照可选。不要把脚本存在或工程检查通过写成业务验收通过。

页面交付另见[默认标准](../../docs/forge-page-delivery-standard.md)和[精修基线](../../docs/forge-page-polish-baseline.md)。纯文档整理按链接、引用及内容一致性验证，不启动业务服务。

## 发布边界

仓库保留 [Dockerfile](Dockerfile) 和 [docker-compose.yml](docker-compose.yml)；这些文件存在不代表当前版本已完成部署、恢复或客户交付验证。实际发布须遵循[正式版本交付要求](../../docs/first-release.md)，按本次版本记录配置和证据，不沿用脚手架的默认服务能力承诺。

单机或客户内网部署使用 `scripts/deploy.sh`。公网同源入口由独立 Nginx 容器提供，Forge 应用端口只暴露在 Compose 内网。Nginx 对文本和 JSON 使用 gzip；仅 200、内容哈希命名且 MIME 属于 JavaScript、CSS 或字体的资源可获一年浏览器缓存。HTML 需重新验证，带认证的响应保持私有，写入、认证和上传响应不缓存；SSE/MCP 流按事件到达且不压缩。Nginx 不启用共享响应缓存。

发布脚本按同一源码提交构建带修订标识的应用和代理镜像，发布前备份已有 PostgreSQL；先在仅绑定回环地址的候选端口验证 Nginx 与 Forge，再更新应用、重新验证候选入口，最后切换公网端口。任一健康检查失败会尝试恢复上一应用与代理镜像；首次由直连切换到代理时，失败则恢复上一应用的原公网端口。发布记录写入 `.deploy/releases/`，包含镜像标识、端口和备份位置，不含密钥。环境差异只放在未提交的 `.env` 中，业务数据继续保存在独立 Docker volume。

```sh
./scripts/deploy.sh
```

候选端口默认使用 `127.0.0.1:14612`，可通过未提交的 `FORGE_CANDIDATE_PORT` 调整，但必须与 `FORGE_HTTP_PORT` 不同且未被占用。公网端口仍由 `FORGE_HTTP_PORT` 控制。

没有容器运行时的开发机可用本机或临时构建的 Nginx 运行传输 smoke。该脚本只启动本地模拟上游和 Nginx，不访问 Forge 数据库：

```sh
NGINX_BIN=/path/to/nginx \
FORGE_TRANSPORT_UPSTREAM_PORT=4612 \
FORGE_TRANSPORT_PORT=14612 \
node tests/transport-smoke.mjs
```

部署脚本的候选发布、首次接入回退和既有代理回滚也可在无 Docker 环境下用模拟命令验证：

```sh
node tests/deploy-transport.mjs
```

端口可用性由运行 smoke 的开发机自行确认；需要调整时改用不同的 `FORGE_TRANSPORT_UPSTREAM_PORT` 和 `FORGE_TRANSPORT_PORT`。

服务器需要通过 `sudo` 使用 Docker 时，先显式传入待发布提交，避免以 root 身份读取 Git 工作树：

```sh
FORGE_SOURCE_REVISION="$(git rev-parse HEAD)" sudo --preserve-env=FORGE_SOURCE_REVISION ./scripts/deploy.sh
```
