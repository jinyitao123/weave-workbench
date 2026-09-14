# Weave 集成边界

[English](weave-integration.md) | 中文

Workbench 维护浏览器和 TypeScript 交互 Host，通过 `/v1` HTTP API 与管理员安装的 `weave mcp serve` 命令连接外部 Weave 平台。安装、构建和测试 Workbench 不需要 Go 源码、平台数据库、任务队列或父级源码目录。

## 兼容基线

首个独立源码基线来自 Weave 提交 `9fc21c4da70fb59ba1f36d92b21b1be148259662`。对应 MCP 可执行文件和平台 API 必须支持相同的账号委托、绑定派发输入版本、任务动作和交付契约。部署应使用版本匹配的 Weave 构建，并记录可执行文件版本与校验和、平台版本和 Workbench 提交。HTTP `/v1` 只标识 API 代际；连接成功本身不构成兼容验收。

## 管理员输入

| 输入 | 责任 |
| --- | --- |
| `WEAVE_API_URL` | 可访问的外部平台 API 地址 |
| `WEAVE_COMMAND` | 受信任且版本匹配的 MCP 可执行文件，通过 `mcp serve` 启动 |
| `WEAVE_API_KEY` | Host 服务凭据，不进入浏览器或模型输入 |
| 浏览器平台账号 | 已验证用户授权，绑定到每个 Session 和 MCP 请求 |
| `DSH_HOME` | 源码目录之外的 Host 运行数据目录 |

Host 使用 `X-Weave-User-Authorization` 传递委托 HTTP 身份，并在 MCP 请求元数据中传递对应身份。身份由服务端验证；任务文本和请求正文中的用户声明没有授权效力。缺少用户授权时不得回退使用 Host 服务身份。Host 重启和退出登录会使活动用户授权失效。

## 部署边界

独立 Dockerfile 只构建本仓，不构建 Go，也不从 Weave 平台镜像复制程序。`deploy/compose.yaml` 以只读方式挂载单独取得的 Linux MCP 可执行文件，并连接外部 API。可执行文件必须与容器架构匹配。生产密钥和管理员 `.env` 文件保存在 Git 之外；`deploy/.env.example` 只含占位符。

团队派发仍是 Weave 持久任务。Workbench 前台对话、后台观察和界面投影不拥有平台任务租约、重试、总期限、额度、取消回执或最终交付状态。真实验收覆盖同一 Host 上的两个账号、退出与过期、普通个人任务创建、精确运行交付以及配置的运行时和模型组合。
