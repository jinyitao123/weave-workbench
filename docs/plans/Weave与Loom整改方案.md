# Weave 与 Loom 整改方案

本页是 Weave 与 Loom 整改的唯一方案文档：范围、工作包、顺序与验收。依据是[决策 001](../decisions/001-Weave平台范围收窄与唯一客户端.md)；问题条目见[问题清单](问题清单.md#2026-09-29-代码体检新增问题)；实际进展只在[项目状态](../项目状态.md)维护。

方案来源：2026-09-29 对总仓 `main@99a2e0fa`、Weave `weave-next@b2bafac7`（Loom `ae8cb201`）、Forge `8a8ec482` 的代码与文档审阅。审阅没有运行测试，也没有访问 124；下文“当前事实”均为代码级证据，标注了文件位置。

## 目标与不做的事

**目标：** Weave 收窄为团队平台核心加多运行时，GooeyPi 加 Forge 是唯一客户端；Loom 的持久恢复变得可复现、可回归；三场景用到的团队执行链路先做到可靠，再瘦身和重新分仓。

**不做：**

- 不重写 Weave。任务租约、领取世代、结果敏感任务在租约丢失后判失败、业务动作防重放、outbox 回收，这些内核不变量是对的。
- 不给 Loom 加 Weave 专用钩子。Loom 只负责单个智能体的图、循环、检查点和重放契约。
- 不在 MVP1 验收期间推进分仓。
- 不用“成员从头重跑”替代持久恢复。

## 当前事实

| 事实 | 证据 |
| --- | --- |
| Weave 生产代码约 17.8 万行，共 203 个路由；桌面实际调用约 20 组接口 | `internal/app/api/server.go`；桌面 `electron/main/enterprise.ts`、`enterprise/team-workspace.ts` |
| 桌面建团队、编辑、试跑、发布、交接，都没有调用团队模板、建队运行、评测、元团队，也不经过网页 Workbench | 同上；Weave `team_development*.go`、`org.go`、`workflows.go` |
| 流程发布借用 `teamconstruction` 中的产品发布代码；智能体接口引用元团队成员名 | `internal/app/api/workflows.go:339`、`internal/app/api/agents.go:254` |
| 元团队默认启用，每次启动写入 `default` 工作空间（即 124 的 MVP1 组织） | `internal/kernel/config/config.go:107`、`cmd/weave/main.go:292` |
| Loom 约 9 千行；Weave 包在外面的执行层约 1.8 万行，其中约 8 千行处理终态、谱系与用量 | `third_party/loom`；`internal/kernel/loomruntime` 等 |
| 成员恢复通过重放日志中的模型与工具响应重建工具循环；09-26、09-29 两次真实失败都在恢复阶段 | `internal/kernel/loomruntime/member_run.go:316`；[合同场景](../../scenarios/sales-contract-handoff/合同场景设计.md) |
| 业务动作防重放按模型生成的 `tool_call_id` 精确匹配；按能力加记录的匹配只拦截结果未知的调用 | `internal/kernel/teamrun/activity.go:253` |
| 没有把失败运行从 124 导出到本地复现的工具 | `scripts/`、`tools/`、`cmd/` 中未见 |

## 工作包

代码类工作包都在 `weave-next`（Weave）或 Loom 源码仓完成，再按[开发与发布方式](../architecture/开发与发布方式.md)同步到总仓 `platform/weave`，不直接改集成副本。Go 版本以 `weave-next/go.mod` 为准（当前 `go 1.26.1`）。

### W0 规则对齐（文档，最先做）

在 `weave-next` 修改两份文件，使其与决策 001 一致：

- `AGENTS.md`：
  - `workbench/` 标为已下线，冻结不改。
  - 写明唯一客户端、保留与下线清单、下线步骤。
  - 写明 `weave-next` 为唯一主干、分仓暂停；恢复回归放在 Loom。
  - 产品验收改为从 GooeyPi 桌面发起、在 Forge 页面独立读回。
  - 删除“迁移期间不新增产品功能”。
- `docs/架构/2026-09-05-Weave-当前产品合同.md`：围绕 GooeyPi 加 Forge 重写；保留“卡住后怎么办”的规则；网页 Workbench 试点记录标为历史。

**验收：** 两个文件中不再出现“网页 Workbench 是唯一业务界面”一类的现行规则；`make depguard base-depguard productguard` 通过。

### W1 部署先关（小改动，可回退）

1. 124 Weave 环境设 `WEAVE_METATEAM_ENABLED=false`。
2. Compose 不再启动 `workbench` 与 `workbench-gateway` 服务，保留数据目录。
3. 在 `internal/app/api/server.go` 的路由注册处加一个部署开关，关闭时不注册以下接口：团队模板、`internal/team-build-runs` 与 `team-build-runs`、团队评测、`/v1/auth/login`、`/v1/auth/register`。开关默认值按 124 的需要设定，并写进部署文档。
4. 元团队已写入的数据保留，不删除。

**验收：** 部署后在真实桌面依次完成：小周新建团队、编辑成员与能力、试跑、发布；小王交接一次只读工作并收到结果消息。对应接口：`agents`、`teams`、`config-draft`、`teams/:id/development`（含 `trials`、`publish`）、`workflows/:id/drafts|validate|publish`、`workbench/dispatch-inputs`、`teams/:id/dispatch`、`runs`、`deliverables`、`human-tasks`。被关闭的接口返回 404；Weave 日志中这些路径没有调用。

### W2 运行复现包（后续所有运行时改动的验证前提）

在 `weave-next` 增加运维命令，例如 `weave ops export-run <run-id>`（放在运维 CLI，不开放 HTTP），导出一次运行的完整、脱敏现场，并能在本地 Compose 中导入回放。

- **导出范围**（表名已在源码中确认，字段盘点在实现时完成）：
  - `weave_team_runs`、`weave_run_delivery_state`
  - 同一 `run_snapshot_id` 的 `weave_task_queue` 行
  - `weave_run_attempt_leases`、`weave_run_terminal_markers`
  - `weave_workflow_member_runs`（成员日志与检查点）、`loom_store`
  - `weave_team_run_activity_events`
  - `weave_dispatch_input_revisions`
  - `weave_published_artifact_contents`（对应版本）
  - `weave_employee_run_event_outbox`
  - `weave_task_business_delegations`
- **脱敏：** 不导出 `credential_ciphertext`、`credential_sha256` 和任何令牌。材料正文按开关决定是否导出，默认只导出引用、长度和摘要。
- **本地回放：** 导入后，用一个“录制响应提供方”按日志顺序返回原模型响应。Forge 工具调用用只读桩返回已记录的结果，不访问真实 Forge。

**验收：** 09-29 合同场景第二次运行（Loom 恢复工具消息时失败）能在本地以相同错误复现；导出文件中找不到任何凭据字段。

### W3 Loom 恢复回归矩阵（在 Loom 仓）

在 Loom 仓 `tests/` 增加按模型提供方录制的恢复用例，覆盖 `stdlib.ExecutionJournal` 的重放契约：

- 模型返回 `tool_calls` 之后、工具结果之前中断，恢复后不丢失 assistant `tool_calls`（09-26 失败类型）。
- 工具结果已记录、下一次模型调用之前中断，恢复后工具消息完整（09-29 失败类型）。
- 同一轮多个并行 `tool_calls`、额度暂停后恢复、结果未知（`ErrJournalOutcomeUnknown`）时停止且不重复执行。
- 每个用例分别使用 DeepSeek 与 OpenAI 两种格式的真实录制响应。

录制数据来自 W2 的导出，并去掉业务正文。Loom CI 在三平台运行这些用例。完成后更新 `weave-next/third_party/loom` 与其 `UPSTREAM` 记录。

**验收：** 在已知有缺陷的 Loom 提交上，对应用例失败；在当前提交上通过；W2 复现的失败在修复后本地回放通过。

### W4 业务动作防重放按内容识别

修改 `internal/kernel/teamrun/activity.go` 的 `CheckBusinessActionReplay` 及其记录：

- 在 `business_action_started` 中记录规范化参数摘要。计算时包含 Weave 注入的记录和材料绑定值。
- 同一运行、同一输入版本、同一能力、同一记录、同一参数摘要，如果已有成功结果，就把原结果返回给成员，不再调用 Forge；结果未知的继续拦截；失败的允许成员按新参数重试。
- 参数不同的调用互不影响。例如同一次运行调整同一报价的两行价格是合法的。

**验收：** PostgreSQL 集成测试覆盖：成员重试后以新调用 ID 重发同一动作不会再次到达 Forge；同一运行调两行不同价格都能执行；结果未知时被拦截。Weave 向 Forge 传稳定幂等键涉及 Forge 动作契约，列入 C21，不在本工作包。

### W5 平台正确性小修

| 项 | 做法 | 位置 |
| --- | --- | --- |
| 运行级业务结果 | 服务端统一计算“完成 / 需补充 / 动作失败 / 动作结果未知”，续办上下文与员工事件都用它；桌面不再各自推导 | `internal/kernel/teamrun`、`internal/app/api/workbench_context.go`、`employee_run_events.go` |
| 开发试跑与正式运行共用记录器 | 合并记录路径，用模式区分；增加契约测试，让同一流程分别走两条路径，比对落库的交付分类与中间步骤输出 | `internal/app/api/team_development_runs.go` 及交付记录 |
| 永久投递失败 | `permanent_failure` 在运维 CLI 可列出、可在修复配置后重投；出现时写告警日志 | `internal/app/api/employee_run_events.go:328` |
| 资源条数 | 登记接口与运行时使用同一上限，并同步契约；在接单前拒绝，不在运行时才失败 | `dispatch_input.go:198`、`businessaction/runtime.go:318` |
| 死代码 | 删除不检查租约的 `Complete`、`Fail` | `internal/kernel/taskqueue/store.go:395`、`:432` |

### W6 终态、谱系与用量合并（先探查，MVP1 验收后实施）

先写一份探查结论，补进本页：列出 `weave_run_terminal_markers`、`weave_workflow_member_runs`、`weave_run_attempt_leases`、`weave_team_run_activity_events` 和用量累计的全部写入方、写入时机和一致性依赖。目标是每次成员尝试只有一个写入方写一条终态，和任务完成放在同一事务提交；谱系在查询时推导，不再重建和修补（`terminal_v3_lineage_rebuild.go`、`terminal_lineage_repair.go`）。W2、W3 就绪之前不动这部分代码。

### W7 删除下线代码与重新分仓（MVP1 验收后）

1. W1 关闭满一个版本周期，并确认没有调用。
2. 把流程发布使用的产品发布代码从 `internal/app/teamconstruction` 移到发布相关的包；去掉 `agents.go` 对元团队成员名的引用。
3. 删除团队模板、建队运行与评测、元团队、网页 Workbench 代码，以及对应的 README、安装脚本和 Compose 内容。
4. 124 `default` 工作空间中的元团队数据，另行确认后清理。
5. 以 `weave-next` 为起点重新切分：不再设独立的网页 Workbench 仓，`weave-builder` 按保留的编排与恢复策略重新界定范围。

## 顺序与依赖

```text
W0 ─┬─ W1
    └─ W2 ── W3
          └─ W4 ── W5 ── MVP1 验收 ── W6 ── W7
```

- W0、W1 可以立即开始；W1 只改部署和路由注册，不影响执行路径。
- W2 是 W3、W4 以及之后所有运行时改动的验证前提。
- 跨组件的委托问题（C15、C16）和 Forge、桌面侧问题（C18–C24）按问题清单单独排期；W4 与 C21 的幂等键方案需要一起评审。

## 执行环境

当前总仓所在的 Windows 主机没有 Go 和 Node，不能运行 Weave、Loom 或桌面检查。代码类工作包在已有 `weave-next` 与 Loom 源码的 macOS 开发机上执行；每个工作包完成后，在 `weave-next` 形成提交并通过 `make test depguard base-depguard productguard`，再按正常方式同步总仓组件锁。
