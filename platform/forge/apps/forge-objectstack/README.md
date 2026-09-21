# Forge ObjectStack

这是 Forge 的 ObjectStack 应用，包含业务对象、动作、运行时 hooks 和 Console 页面。入口为 [objectstack.config.ts](objectstack.config.ts)，依赖版本和可执行命令以 [package.json](package.json) 为准；不在说明中手工维护容易过时的对象、字段或页面总数。

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

再执行对应业务链的验收脚本。涉及持久状态时，使用同一 SQLite 完整停服重启回读；页面与业务验收还必须满足主仓的双侧浏览器和同材料对照要求。不要把脚本存在或工程检查通过写成业务验收通过。

页面交付另见[默认标准](../../docs/forge-page-delivery-standard.md)和[精修基线](../../docs/forge-page-polish-baseline.md)。纯文档整理按链接、引用及内容一致性验证，不启动业务服务。

## 发布边界

仓库保留 [Dockerfile](Dockerfile) 和 [docker-compose.yml](docker-compose.yml)；这些文件存在不代表当前版本已完成部署、恢复或客户交付验证。实际发布须遵循[正式版本交付要求](../../docs/first-release.md)，按本次版本记录配置和证据，不沿用脚手架的默认服务能力承诺。

单机或客户内网部署使用 `scripts/deploy.sh`。它按源码提交生成固定镜像版本，发布前备份已有 PostgreSQL，健康检查失败时恢复上一镜像，并把不含密钥的发布记录写入 `.deploy/releases/`。环境差异只放在未提交的 `.env` 中，业务数据继续保存在独立 Docker volume。

```sh
./scripts/deploy.sh
```

服务器需要通过 `sudo` 使用 Docker 时，先显式传入待发布提交，避免以 root 身份读取 Git 工作树：

```sh
FORGE_SOURCE_REVISION="$(git rev-parse HEAD)" sudo --preserve-env=FORGE_SOURCE_REVISION ./scripts/deploy.sh
```
