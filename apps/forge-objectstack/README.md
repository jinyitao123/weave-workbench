# Forge ObjectStack

当前这里通过 [objectstack.config.ts](objectstack.config.ts) 注册共享核心插件和 [七个应用包](src/apps/index.ts)。七应用的业务、页面、权限、设置与持久化仍须逐项按合同验收；注册完成不表示各应用功能已完整或通过验收。依赖版本和可执行命令以 [package.json](package.json) 为准；不在说明中手工维护容易过时的对象、字段或页面总数。

业务范围、质量要求与当前资料入口见[项目首页](../../README.md)、[项目规则](../../AGENTS.md)和[文档索引](../../docs/README.md)。

## 本地开发

在本目录执行：

```sh
pnpm install
pnpm dev --help
pnpm dev
```

先为当前任务选择未占用的独立端口与独立 SQLite，再启动开发服务；实际 Console/API 地址和持久库位置以启动配置及日志为准。不要照抄旧报告的端口或数据库路径，也不要为验证文档修改重启正在使用的服务。

`pnpm dev` 是 package.json 定义的开发入口，不代表已有环境已启动、已登录或数据已准备。登录使用当前测试环境配置，本文件不维护账号密码。API 验收脚本须在本机环境显式设置 `FORGE_TEST_PASSWORD`，未提供时会拒绝登录；同时显式设置指向本任务环境的 `FORGE_URL`，不得借用主线环境证明分支通过。API 客户端入口回归运行 `pnpm test:api-client`。

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

Forge CLI 17.5.0 会通过自身的 `resolveConsolePath` 解析 Console 包，版本以 [`console94.lock.json`](console94.lock.json) 为准。pnpm 锁文件将 `@objectstack/console` 留在 CLI 的虚拟依赖树里，应用顶层通常没有 `node_modules/@objectstack/console`。打包脚本调用 CLI 同一解析器定位真实包目录后再注入，不假设顶层路径；注入前复制旧 `dist` 作为回滚备份，目录替换遇到 overlay 文件系统的跨设备错误时改用复制，摘要验证失败则从备份恢复。注入路径及产物摘要会写入构建期布局标记。最终镜像再用 runtime 内的 CLI 重解析该包，并逐文件校验摘要与构建期路径标记一致。Forge API、`/api/v1/mcp` 和事件流仍由原 Nginx `location /` 转发到同一个 Forge 服务。

Forge 项目支持 Node 24 及以上。产物来源与完整摘要由 [`console94.lock.json`](console94.lock.json) 锁定；构建要求 Node 24 及以上、pnpm 10.x；锁中的 `nodeVersion`、`pnpmVersion` 只记录生成该锁时实际使用的版本，复现以构建后逐字节核对锁中摘要为准，摘要不一致即失败。先让 `OBJECTUI_SOURCE_DIR` 指向含锁定提交的 ObjectUI Git checkout，再执行：

```sh
OBJECTUI_SOURCE_DIR=/path/to/objectui pnpm console94:build
pnpm console94:verify
node scripts/inject-console94.mjs . .generated/console94 .generated/console94-layout.json
node tests/console94-pnpm-layout.mjs
pnpm console94:cli-smoke
```

构建脚本用 `git archive` 读取锁定的 ObjectUI 提交，不读取工作区改动。它仅在构建子进程移除 `CI`、`VERCEL`，确保生成锁中包含的 gzip/Brotli 文件，父环境保持不变。站点基路径固定为 `/_console/`；移除包含构建机绝对路径的分析文件 `stats.html` 后，先核对每个 gzip 的标准单成员头、CRC、长度及解压内容与原文件一致，再只把 OS 头字节规范为 [RFC 1952](https://www.rfc-editor.org/rfc/rfc1952) 的 `255`（unknown）。带可选头、额外成员或尾随数据的输入会被拒绝，压缩数据和其他字节保持不变。

规范后的完整文件树仍逐字节计算并核对锁中摘要，不以解压内容摘要代替。随后修正生成 HTML 的 manifest 相对地址、写入来源标记，并核对最终完整树摘要。规则由 `console94.lock.json` 的 `gzipNormalization` 声明；产物写入 `.generated/console94/`，已加入 Git 与主构建上下文忽略列表。

Docker Compose 通过 BuildKit `additional_contexts` 注入该目录；直接使用 Compose 构建时，也将 `console94-build.env` 中的源码修订和树摘要传入 `FORGE_CONSOLE_SOURCE_REVISION`、`FORGE_CONSOLE_TREE_SHA256`。Docker build stage 使用同一 CLI 解析器定位并注入 Console；runtime stage 在复制完整 pnpm `node_modules` 后，再用运行时自身的 Node 与 CLI 重解析并校验路径和摘要。`scripts/deploy.sh` 自动传递同一上下文和摘要，并在备份和切换前检查构建材料。Docker 镜像标签及发布记录都写入 Console 源提交与树摘要。ObjectStack runtime 固定为锁中 `17.5.0` 的 OCI digest，与 Forge 锁定的 CLI 主机版本配套；现有发布流程通过重新启用上一应用/代理镜像回滚，候选失败时不会改变公网入口。

Forge app build stage 使用 Node 24.19.0，依赖树含原生 `better-sqlite3`。运行时及 native addon 的实际加载行为须以锁定镜像和本次候选启动检查为准；此前17.3／Node22组合的观察不作为当前17.5镜像证据。候选镜像启动健康检查必须通过后才能接受该镜像组合；静态构建和 Console 文件校验不替代这一步。

单机或客户内网部署使用 `scripts/deploy.sh`。公网同源入口由独立 Nginx 容器提供，Forge 应用端口只暴露在 Compose 内网。Nginx 对文本和 JSON 使用 gzip；仅 200、内容哈希命名且 MIME 属于 JavaScript、CSS 或字体的资源可获一年浏览器缓存。HTML 需重新验证，带认证的响应保持私有，写入、认证和上传响应不缓存；SSE/MCP 流按事件到达且不压缩。Nginx 不启用共享响应缓存。

容器启动时沿 `scripts/start-with-migrations.sh` 执行预检，再启动正式服务。空 PostgreSQL 库通过固定版本 ObjectStack 导出的 `NotificationDelivery` 和原生 SQL driver 建立通知投递表；三个租约字段按 `numericColumnFor` 核对，保留17.5原生 `numeric(65,30)` 和已有 `double precision`。原生 SQL driver 按字段声明将数值读回为 JavaScript number，租约确认继续使用原生严格比较及CAS。遇到17.3的 `real` 时，[精度迁移](scripts/schema/notification-lease-precision.sql)只将对应旧列升为 `double precision`；只有 `claimed_at` 原为 `real`，无法证明原始毫秒令牌时，才将其在途领取退回待处理并保留尝试次数。仅重试或尝试时间列迁移不重置合法领取；已经正确的列与成功记录保持原样，未知类型或非规范numeric精度拒绝启动。空库、重复预检、原生claim/ack和迁移行为由 `scripts/schema/notification-lease-preflight.test.mjs` 验证，需显式提供指向本机专用 `forge_lease_preflight_` 前缀数据库的 `FORGE_NOTIFICATION_TEST_DATABASE_URL`；未提供时PG用例跳过，不能作为空库已验的证据。

销售合同与订单行迁移只放宽旧库 `sku_id` 的物理 `NOT NULL`，保留所有现有明细；草稿 Action 继续要求物料行带 SKU，并拒绝服务行携带 SKU。销售合同草稿 Action 同时显式写入 `owner_id`；启动前迁移只将 `owner_id` 为空、状态为草稿且 `created_by` 与 `responsible_id` 相同的历史合同归还给该负责人，其他合同不改。新库由当前对象字段直接建表。任一迁移失败则不启动应用和消息处理器，不等待首条业务写入才手工修表。该流程用于当前单机单应用进程部署；升级前须停止旧应用，不适用于新旧消息工作进程并发执行迁移。原根目录日期 SQL 已迁入应用构建上下文，历史执行证据仍可按旧提交追溯。

发布脚本按同一源码提交构建带修订标识的应用和代理镜像，发布前备份已有 PostgreSQL 及附件卷，记录两份备份路径；备份目录／文件以0700／0600创建，任一备份失败则不构建或切换。`.deploy`、运行数据及环境文件不进入 Docker 构建上下文。备份校验只证明压缩包可读，恢复能力仍须在隔离环境实际验证。随后在仅绑定回环地址的候选端口验证 Nginx 与 Forge，再更新应用、重新验证候选入口，最后切换公网端口。任一健康检查失败会尝试恢复上一应用与代理镜像；首次由直连切换到代理时，失败则恢复上一应用的原公网端口。镜像回退不自动恢复数据库。发布记录写入 `.deploy/releases/`，包含镜像标识、端口和备份位置，不含密钥。环境差异只放在未提交的 `.env` 中，业务数据继续保存在独立 Docker volume。

### 部署容量检查

2026-10-07标准部署曾在普通可用空间约1.6GB时继续构建，构建完成后可用为0，新应用切换及原镜像回退健康均失败。人工清理未使用构建缓存后，先恢复旧镜像，再沿原激活步骤启用已构建的准确候选；未恢复数据库。该失败不能由后续恢复追改为首轮发布成功。

当前 `scripts/deploy.sh` 在以下阶段分别检查应用目录、原生 `docker info --format '{{.DockerRootDir}}'` 返回的实际目录，以及备份目标所在文件系统。备份目录尚不存在时，先检查其最近已存在父目录，再创建发布目录，避免磁盘已满时先执行写入。

| 阶段 | 默认普通可用空间 | 后续操作 |
| --- | --- | --- |
| before-backup | 4GiB | 创建发布目录与备份 |
| before-build | 4GiB | 已备份后的两镜像构建 |
| before-candidate | 1GiB | 候选启动及首次应用初始化 |
| before-app-switch | 1GiB | 候选健康确认后的应用切换 |

检查固定用 `df -Pk` 的Available列，单位KiB；不使用root保留块、总量减已用、或不同磁盘空间相加。DockerRootDir无效／不可访问、df失败／数字无法可靠解析都拒绝；输出阶段、位置、可用量或unknown及要求。门禁不执行prune、删除数据、数据库恢复或第二次部署；切换后的原健康检查和镜像回退语义保持。脚本须在Docker数据目录可直接核对的部署主机执行。

通过环境变量 `FORGE_DEPLOY_MIN_BUILD_GIB` 与 `FORGE_DEPLOY_MIN_SWITCH_GIB` 明确调整阈值。两者只接受1至1048576的十进制正整数GiB，空值、0、前导零及非法值拒绝；默认分别4与1。每次输出所用阈值，成功发布的 `release.env` 记录 `minimum_build_available_gib`／`minimum_switch_available_gib`。检查不预留空间；构建后和候选健康后的复核用于阻止已低于切换要求的后续动作。

容量检查、备份、候选及两类既有回退由同一 `tests/deploy-transport.mjs` 的50个真实Shell stub用例验证，不调用Docker运行时、业务服务或数据库；Shell语法与Console包装检查另行通过。这是发布编排组件证据，不代表业务恢复、真实镜像构建或备份恢复验证。

#### 复用既有镜像的恢复边界

上述a522激活tail恢复是冻结旧脚本的真实证据，不代表新容量门禁已执行。新版本如需复用已构建镜像，必须从同一已审源码取得阈值初始化／校验、四个容量函数（`validate_capacity_threshold`、`capacity_unknown`、`check_available_space`、`check_deploy_capacity`），以及真实AppRoot／BackupRoot、发布目录、当前与上一应用／代理镜像等标准prefix；再保留从 `before-candidate` 容量检查开始的原cleanup／rollback及 `before-app-switch` tail。执行前启用 `set -eu` 并核四函数存在，不能只沿旧 `FORGE_HEALTH_ATTEMPTS` anchor截取tail，也不能假定旧私有runner已包含新函数。未按此构造和复核不得执行；不能source完整脚本重复备份／构建。本次没有增加恢复CLI、自动恢复模式或重试循环；备份目标的有限dirname上溯只是解析实际文件系统路径。此恢复构造规则尚非新增恢复执行证据。

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


### 员工本人销售订单办理

销售订单阶段复用员工本人身份、原生岗位、业务 Action 和原生审批。合同负责人先确认结构化下单付款条件，独立签署归档后登记并复核必要预收款，再创建与审批订单。`employee_only` 动作在任务委托签发、目录、对象动作元数据和调用四处均不可交给团队；桌面接口提供版本绑定和原操作回执，本人事项只投影业务记录。

原生审批决定与业务结果分别记录。订单生效、合同累计及拒绝后的预收关联释放在同一事务中应用；中断时通过“核对并完成订单”读取原审批结论并补全同一业务结果。`sales-order-preflight.mjs` 在发布启动前仅放宽旧预收／退款表的订单引用，不更改原关系或金额；对象校验继续要求合同或订单来源。

本批专门检查为 `acceptance:sales-order-native`、`acceptance:employee-business-native` 和 `tests/sales-order-preflight.native-postgres.test.mjs`，必须指向隔离本机 PostgreSQL。组件检查不代表桌面跨员工业务验收；完整范围和部署证据由产品总仓的销售订单场景及环境说明维护。

已批准订单沿同一连接由销售负责人准确立项／关联、明确经理本人启动；实现、原生读取边界、未知失败及后续并发修补证据维护在[接入主文档](../../docs/任务授权与工作消息接入.md#已批准订单接项目的本人边界)。本批不包含交付／制造／财务后续。

### 本人创建与草稿付款条款

本人连接支持 `sales_lead_create`、`sales_quotation_draft_create` 和已有合同上的 `contract_draft_payment_term_update`。创建动作通过原生 `list_toolbar` 范围声明为无需记录；`sourceKind=creation` 上下文没有虚构的记录或记录版本，继续使用既有上下文和操作回执对象。组织、归属、状态和创建编号由服务器确定；销售内部估算独立保存为可空的 `estimated_amount`，不代表客户预算。

报价输入为固定八字段的 `lineItems`，连接层验证后交给原有头行事务。联系人、客户、商机、字典和规格通过本人员工原生读取核对；超过单次候选范围时先用已有只读查找选定记录，通过 `referenceIds` 缩小候选，不把展示数量变成企业数据总量上限。服务行不传 SKU，成本保持未知。旧页面的报价草稿入口继续使用原动作。

付款条款动作仅处理本人尚未进入审批的草稿，不修改金额、明细或其他状态。相同操作沿原回执返回，异参、旧版本和未知操作换键均被拒绝。聚焦真实 HTTP／PostgreSQL 检查可在既有隔离数据库设置下运行 `FORGE_EMPLOYEE_CREATION_PG_ONLY=1 pnpm acceptance:employee-business-native`；它覆盖旧上下文物理约束、本人权限、创建引用、头行、条款和原回执回滚。此检查不代表桌面员工流程或部署完成；跨组件协议以产品总仓 `contracts/v1/README.md`「本人业务创建与草稿补充」为准。
