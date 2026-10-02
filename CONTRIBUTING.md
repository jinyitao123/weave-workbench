# Contributing

欢迎通过 Issue 和 Pull Request 参与。本文说明这个总仓怎样协作；人和 Agent 都适用，完整的仓库规则见 [AGENTS.md](AGENTS.md)。

## 先确认改动应该落在哪里

| 改动内容 | 提交到 |
| --- | --- |
| 桌面客户端（`desktop/`）、跨组件契约（`contracts/`）、场景（`scenarios/`）、文档、工具 | 本仓 |
| Weave、Loom 与团队执行（`platform/weave/`） | 源码主仓 [weave-next](https://github.com/jinyitao123/weave-next)，本仓只同步指定版本 |
| Forge 业务应用（`platform/forge/`） | 源码主仓 [inoForge](https://github.com/jinyitao123/inoForge)，本仓只同步指定版本 |

`platform/` 下是锁定版本的集成副本，请不要在本仓直接修改。同步与回流方式见[开发与发布方式](docs/architecture/开发与发布方式.md)。

跨组件的接口变更先改 [contracts/](contracts/README.md)，写清调用者、身份、幂等键、输入、输出、错误、取消语义和审计字段，再由各组件分别实现。

## 开发环境

- Node.js 24.15 或更新、npm 12：桌面客户端与仓库工具。
- Go（版本见 `platform/weave/go.mod`）与 PostgreSQL：Weave。
- pnpm 10：Forge。
- 桌面以 macOS 为第一验收平台，Windows 必须保持可构建。

## 提交前检查

```sh
make check            # 文档、布局、版本锁与状态页检查，所有改动都要通过
make desktop-check    # 桌面类型检查、lint 与单元测试
make weave-check      # Weave 测试与依赖边界
make forge-check      # Forge 类型检查与校验
```

只运行与你的改动相关的组件检查。组件检查通过只说明组件可用，跨组件的业务结果需要在真实桌面和 Forge 页面中走通后才算验收通过，见[验收规则](AGENTS.md#验收规则)。

## Pull Request

1. 从 `main` 新建分支，一个 PR 只做一件事，并说明目的、范围和已执行的检查。
2. 提交信息使用 `类型(范围): 说明`，例如 `docs(status): ...`、`fix(desktop): ...`。
3. 行为变化要带测试；界面改动附截图。
4. 文档遵循“一主题一主文档”：先找已有文档再决定是否新建，不用日期、`v2`、`副本` 区分版本；文件名使用表达用途的中文名。详细规则见 [AGENTS.md](AGENTS.md#文档管理所有-agent-与开发任务必须遵守)。
5. 不要提交密码、令牌、密钥、服务器地址或个人本机路径。发现已提交的敏感信息，请按[安全政策](SECURITY.md)私下报告。

## 行为准则

请保持专业、尊重和就事论事：不对个人作评价，不骚扰，不公开他人的隐私信息，对技术分歧用证据讨论。维护者可以删除不当内容，并限制反复违反者的参与。

## 许可证

向本仓提交的内容按所在目录的许可证授权：`desktop/` 与 `platform/weave/` 保留 MIT，其余默认使用 [Apache-2.0](LICENSE)，子目录已有许可证时以其为准，详见 [NOTICE](NOTICE)。
