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

### 固定构建 ObjectUI Console

Forge CLI 17.3.0 会通过自身的 `resolveConsolePath` 解析 Console 包。pnpm 锁文件将 `@objectstack/console` 留在 CLI 的虚拟依赖树里，应用顶层通常没有 `node_modules/@objectstack/console`。打包脚本调用 CLI 同一解析器定位真实包目录后再注入，不假设顶层路径；注入前复制旧 `dist` 作为回滚备份，目录替换遇到 overlay 文件系统的跨设备错误时改用复制，摘要验证失败则从备份恢复。注入路径及产物摘要会写入构建期布局标记。最终镜像再用 runtime 内的 CLI 重解析该包，并逐文件校验摘要与构建期路径标记一致。Forge API、`/api/v1/mcp` 和事件流仍由原 Nginx `location /` 转发到同一个 Forge 服务。

Forge 项目支持 Node 24 及以上。产物来源与完整摘要由 [`console94.lock.json`](console94.lock.json) 锁定；复现这份 Console 产物时使用 Node 24.19.0 和 pnpm 10.31.0。先让 `OBJECTUI_SOURCE_DIR` 指向含锁定提交的 ObjectUI Git checkout，再执行：

```sh
OBJECTUI_SOURCE_DIR=/path/to/objectui pnpm console94:build
pnpm console94:verify
node scripts/inject-console94.mjs . .generated/console94 .generated/console94-layout.json
node tests/console94-pnpm-layout.mjs
pnpm console94:cli-smoke
```

构建脚本用 `git archive` 读取锁定的 ObjectUI 提交，不读取工作区改动。它将站点基路径设为 `/_console/`，移除仅供分析且包含构建机绝对路径的 `stats.html`，修正生成 HTML 中嵌套路由下会错误解析的 manifest 相对地址，再对注入文件树逐字节校验。产物写入 `.generated/console94/`，已加入 Git 与主构建上下文忽略列表。

Docker Compose 通过 BuildKit `additional_contexts` 注入该目录；直接使用 Compose 构建时，也将 `console94-build.env` 中的源码修订和树摘要传入 `FORGE_CONSOLE_SOURCE_REVISION`、`FORGE_CONSOLE_TREE_SHA256`。Docker build stage 使用同一 CLI 解析器定位并注入 Console；runtime stage 在复制完整 pnpm `node_modules` 后，再用 Node 22 中的 CLI 重解析并校验路径和摘要。`scripts/deploy.sh` 自动传递同一上下文和摘要，并在备份和切换前检查构建材料。Docker 镜像标签及发布记录都写入 Console 源提交与树摘要。ObjectStack runtime 固定为 `17.3.0` 的 OCI digest，与 Forge 锁定的 CLI 主机版本配套；现有发布流程通过重新启用上一应用/代理镜像回滚，候选失败时不会改变公网入口。

当前已确认的官方 `17.3.0` runtime 使用 Node 22，而 Forge app build stage 使用 Node 24.19.0；依赖树含原生 `better-sqlite3`。本机没有 Docker，尚未验证该 native addon 在 runtime 中的加载行为。候选镜像启动健康检查必须通过后才能接受该镜像组合；此次静态构建和 Console 文件校验不替代这一步。

单机或客户内网部署使用 `scripts/deploy.sh`。公网同源入口由独立 Nginx 容器提供，Forge 应用端口只暴露在 Compose 内网。Nginx 对文本和 JSON 使用 gzip；仅 200、内容哈希命名且 MIME 属于 JavaScript、CSS 或字体的资源可获一年浏览器缓存。HTML 需重新验证，带认证的响应保持私有，写入、认证和上传响应不缓存；SSE/MCP 流按事件到达且不压缩。Nginx 不启用共享响应缓存。

容器启动时先执行 `scripts/notification-lease-preflight.mjs`，再启动正式服务。空 PostgreSQL 库通过固定版本 ObjectStack 导出的 `NotificationDelivery` 和原生 SQL driver 建立通知投递表；已有库只核对三个租约字段。遇到 17.3 的 `real` 类型时执行 [精度迁移](scripts/schema/notification-lease-precision.sql)，并验证为 `double precision`；已正确时不重置领取状态。迁移失败则不启动应用和消息处理器，不等待首条通知才手工修表。该流程用于当前单机单应用进程部署；升级前须停止旧应用，不适用于新旧消息工作进程并发执行迁移。原根目录日期 SQL 已迁入应用构建上下文，历史执行证据仍可按旧提交追溯。

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
