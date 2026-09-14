# Weave Workbench

[English](README.md) | 中文

Workbench 是使用智能体团队完成工作的产品工作台。本仓同时维护浏览器界面和承载账号、对话、任务投影与工具桥接的 TypeScript Host。团队构建、执行调度和最终交付事实由外部 Weave 平台负责。

## 安装与运行

需要 Node.js `^22.19.0 || >=24.0.0` 和锁定版本 `pnpm@11.7.0`。所有源码依赖均在本仓，无需相邻的 Weave 源码目录、Go 环境或父仓 Makefile。

```sh
pnpm install --frozen-lockfile
pnpm run build:workbench
pnpm workbench --host 127.0.0.1 --port 3080 --no-open
```

管理员启动 Host 时提供 `WEAVE_API_URL`、受信任的 `WEAVE_COMMAND` 和 Host 服务凭据 `WEAVE_API_KEY`。MCP 命令是单独交付、与平台版本匹配的 `weave mcp serve` 可执行程序；`WEAVE_COMMAND` 可以是 PATH 中的命令或明确路径。macOS 快捷启动还支持现有钥匙串服务。产品账号在浏览器登录，用户令牌不进入浏览器存储，也不能由请求正文声明身份。

普通成员无需选择目录即可新建个人任务，Host 按账号分配工作目录。管理员管理共享项目和 Host 设置。尚未连接平台或未配置前台模型时，页面保留明确的配置缺口，不会声称已经执行团队工作。用户退出或 Host 重启后，需要重新验证账号。

运行状态、用户资料、缓存与凭据放在部署数据目录，不提交到源码仓。`deploy/compose.yaml` 提供仅部署 Workbench 的容器示例，平台、数据库与执行 Runtime 独立部署。容器通过只读挂载获得匹配的 Linux MCP 可执行程序，不从父仓或平台镜像复制程序。

## 开发与验证

```sh
pnpm run check:workbench
```

该入口完成 Host 与 Client 类型构建、浏览器产物构建、运行依赖检查、界面依赖及文案检查、产品组合启动、账号与会话隔离相关 Host 测试、完整 GUI 回归。它不需要真实模型凭据。业务交付验收仍须通过真实浏览器、真实用户身份与模型完成，不能用自动化测试或健康响应替代。

`pnpm run build` 默认构建 Workbench。保留的通用运行包、类型命名和测试资料属于实现与历史来源，不新增独立 DSH 产品入口或发布渠道。工作台对平台的集成约定见 [Weave 集成边界](docs/weave-integration.zh.md)。仓库工作规则见 [AGENTS.md](AGENTS.md)。

## 源码与发布

- `apps/`：浏览器应用、受支持的启动器与桌面预览。
- `packages/`：完整的交互 Host、账号与会话服务、工具桥和界面。
- `vendor/`、`native/`、`patches/`：构建所需的框架源码、本地隔离实现与依赖补丁。
- `scripts/`、`snapshots/`：构建、检查、契约与回归资料。

本次迁移保留既有私有仓库历史，并以普通提交引入新的源码树；来源见 [迁移记录](MIGRATION.md)。发布使用本仓版本和提交生成 Workbench 产物，兼容的 Weave MCP/API 基线单独记录。保留 [MIT 许可证](LICENSE) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。
