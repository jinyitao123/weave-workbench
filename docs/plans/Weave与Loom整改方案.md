# Weave 与 Loom 整改方案

本页是 Weave 与 Loom 整改的唯一方案文档：范围、工作包、顺序与验收。依据是[决策 001](../decisions/001-Weave平台范围收窄与唯一客户端.md)；问题条目见[问题清单](问题清单.md#2026-09-29-代码体检新增问题)；实际进展只在[项目状态](../项目状态.md)维护。

方案来源：2026-09-29 对总仓 `main@99a2e0fa`、Weave `weave-next@b2bafac7`（Loom `ae8cb201`）、Forge `8a8ec482` 的代码与文档审阅。审阅没有运行测试，也没有访问 124；下文初审事实对应上述来源版本，标注了文件位置；当前实现以各工作包与项目状态为准。

## 目标与不做的事

**目标：** Weave 收窄为团队平台核心加多运行时，GooeyPi 加 Forge 是唯一客户端；Loom 的持久恢复变得可复现、可回归；三场景用到的团队执行链路先做到可靠，再瘦身和重新分仓。

**不做：**

- 不重写 Weave。任务租约、领取世代、结果敏感任务在租约丢失后判失败、业务动作防重放、outbox 回收，这些内核不变量是对的。
- 不给 Loom 加 Weave 专用钩子。Loom 只负责单个智能体的图、循环、检查点和重放契约。
- 不在 MVP1 验收期间推进分仓。
- 不用“成员从头重跑”替代持久恢复。

## 初审代码事实（2026-09-29 基线）

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
| 已决定下线的功能约 4 万行 Go（`build/teamforge`、`build/teambuild`、`app/teamconstruction`、`build/teameval` 及建队、评测、模板、掼蛋接口等）；网页 Workbench 的 TypeScript 工作区排除 `node_modules` 后约 67.6 万行，可能含上游带入的包或生成代码，未逐一区分 | 各目录行数统计 |
| 28 个 Weave 包直接引用 Loom，其中 HTTP 层 29 个文件直接使用 `loom.State`、`contract.LLM`、`stdlib.AgentSpec`、`pgstore.PGStore`；设计上的 Loom 执行端口 `loomadapter` 只有 64 行 | `internal/app/api`、`internal/kernel/loomadapter` |
| Loom 图在 5 处分别构建：`compiler`、`declarative`（两处）、`teamcompiler`、`app/api/runs.go` | 同名文件中的 `NewGraph` 调用 |
| DeepSeek “工具历史无法重放 `reasoning_content`、须关闭思考模式”的规则写在 Weave 流程包，按提供方 ID 字符串判断；Loom 自带的 `provider/deepseek` 未使用 | Weave 提交 `b2bafac7`，`internal/kernel/workflow/runtime_host_factory.go` |
| 预算逻辑散在 Weave 7 个包约 30 个文件；Loom 有 60 行的循环内预算与恢复测试 | `third_party/loom/stdlib/budget.go`；Weave `loomruntime`、`teamrun`、`app/api` 等 |

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
2. Compose 不再启动 `workbench` 与 `workbench-gateway` 服务，保留数据目录。仅改 Compose 不够：`scripts/deploy-main.sh` 按名称构建、启动这两个服务，`deployment-state.py verify` 还把网关可达作为部署成功条件，所以部署脚本也须跟随开关。`weave-next` 已用 `server.env` 中的 `WEAVE_WEB_WORKBENCH`（默认关）统一控制构建、启动、存储准备和验证。
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

**2026-09-30 进展（`weave-next` 分支 `rework/weave-platform-scope`，提交 `3ad5f2bd`，未合入 main）：** 导出与导入已完成：`weave ops export-run` / `import-run`，只在运维 CLI，不开放 HTTP。导出在一个可重复读快照内取整次运行的行与以运行编号为键的检查点、成员操作日志；凭据永不导出，默认只留材料正文的长度与摘要，加 `--include-content` 才带正文（此文件含员工交接的内容，不得进入 Git 或对话）；导出前还把从数据库读到的凭据原文（含十六进制形式）在整个文件中搜索，出现即拒绝。导入只写入一次性数据库，拒绝非回环地址，不覆盖已有行。用真实 PostgreSQL 与金丝雀验证并做了变异验证，细节见该仓治理记录。**未完成：** 本地回放（录制响应提供方加只读 Forge 桩）、09-29 失败的真实复现（需要 124 数据）、能力调用与配置类父表未导出，导入因此关闭外键触发器。

### W3 Loom 恢复回归矩阵（在 Loom 仓）

在 Loom 仓 `tests/` 增加按模型提供方录制的恢复用例，覆盖 `stdlib.ExecutionJournal` 的重放契约：

- 模型返回 `tool_calls` 之后、工具结果之前中断，恢复后不丢失 assistant `tool_calls`（09-26 失败类型）。
- 工具结果已记录、下一次模型调用之前中断，恢复后工具消息完整（09-29 失败类型）。
- 同一轮多个并行 `tool_calls`、额度暂停后恢复、结果未知（`ErrJournalOutcomeUnknown`）时停止且不重复执行。
- 每个用例分别使用 DeepSeek 与 OpenAI 两种格式的真实录制响应。

录制数据来自 W2 的导出，并去掉业务正文。Loom CI 在三平台运行这些用例。完成后更新 `weave-next/third_party/loom` 与其 `UPSTREAM` 记录。

**2026-09-30 第一部分（Loom 分支 `test/recovery-matrix`，提交 `53614ec`，未合入 main）：** `stdlib/recovery_matrix_test.go` 用独立写成的、按序号寻址的持久日志，把整个 ToolLoop 从头重放，并在六个日志操作（三次模型、三次工具，含一轮两个并行 `tool_calls`）的每个边界各中断一次：起始记录之前、起始记录之后、副作用之后响应之前、响应记录之后。每个用例断言：每个工具副作用恰好发生一次；副作用已发生而无响应的操作报告为 `ErrJournalOutcomeUnknown`，重放三次仍不再执行，直到宿主核对后才继续；每次发给模型的历史都通过一个独立的 OpenAI 兼容格式校验器（未闭合的 `tool_calls`、孤立的工具消息、重复调用编号、非法参数都会被拒，并有自测）；最终输出与不中断的运行一致；重放输入与记录不符时立即报告分歧。另有“宿主反复崩溃仍能收敛”的用例。共 24 个边界用例加 3 个整体用例；用变异验证过：让核对步骤把已执行的工具当作未执行，用例会失败。**结论：** 在这套契约下 Loom 本身未发现缺陷，09-26 与 09-29 的失败因此更可能出在宿主（Weave）如何记录与恢复，而不在 Loom 的重放实现。

**尚未做（本条仍未完成）：** ① 用 DeepSeek 与 OpenAI 两种格式的真实录制响应，需要 W2 导出；本测试只用脚本化模型和 OpenAI 兼容格式校验器，没有覆盖 DeepSeek 的推理内容回传，`contract.Message` 目前也没有该字段。② 额度暂停矩阵现已在 Loom `d1f1c15` 完成并通过三平台 CI，真实提供方录制仍待补。③ 并行只读工具在日志未串行化时（`SerializeWhenActive=false`）的重放顺序，按序号寻址的日志会因此出现分歧，宿主必须串行化，这一要求应写进 `ExecutionJournal` 契约（属 W8）。④ 三平台 CI 已在 2026-09-30 及整合 PR 完成；Loom PR #3 合入 `5478e5f`。该分支只加测试，未改 Loom 源码，因此 `weave-next/third_party/loom` 不需要更新。

**验收：** 在已知有缺陷的 Loom 提交上，对应用例失败；在当前提交上通过；W2 复现的失败在修复后本地回放通过。

### W4 业务动作按持久操作身份防重放

原内容摘要方案已在整合时修正。相同参数不证明同一操作，模型重建幂等键也会改变摘要；通过开关关闭只能临时保护，不能作为整改完成。

- 宿主从已经持久化的成员工具日志位置确定操作身份，再与冻结输入、执行调用和能力绑定。恢复同一位置保留身份；新位置即使参数相同也允许作为新操作。
- 动作目录声明的幂等参数由 Weave 隐藏并注入稳定操作身份。参数摘要只验证同一操作的内容不可变。
- 在现有运行活动的同一事务锁内核对并占位，覆盖并发预检查及首个调用已完成后的竞争窗口。原始可信回执经有界脱敏保存，重复操作返回原回执；未知结果停止，不盲目重发。
- 旧日志沿用原调用身份与未知结果保护，不以迁移为由伪造成功回执。

**验收：** 真实 PostgreSQL 及实际成员日志路径覆盖同操作更换模型调用 ID 的恢复、不同操作相同参数、同操作内容冲突、系统幂等键不可覆盖、原回执复用、未知停止和并发只有一次外部写入。通过后才将 W4 记为完成；实现进展见项目状态。

### W5 平台正确性小修

| 项 | 做法 | 位置 |
| --- | --- | --- |
| 运行级业务结果 | 服务端统一计算“完成 / 需补充 / 动作失败 / 动作结果未知”，续办上下文与员工事件都用它；桌面不再各自推导。**已在 `weave-next` 分支完成服务端与契约；桌面已接入可选 `run.business_result`，缺省兼容旧接口；整合验证见项目状态** | `internal/kernel/teamrun/business_result.go`、`workbench_context.go`、`employee_run_events.go` |
| 开发试跑与正式运行共用记录器 | **更正（2026-09-30）：** 两条路径在准入之后已共用同一任务与记录路径，分歧只在准入：试跑准入原先不冻结交付契约。已让两条准入共用契约推导并让试跑同样冻结；整链比对仍待做 | `internal/kernel/publicationservice/service.go`、`published_run.go` |
| 永久投递失败 | `permanent_failure` 在运维 CLI 可列出、可在修复配置后重投；出现时写告警日志 | `internal/app/api/employee_run_events.go:328` |
| 资源条数 | 登记接口与运行时使用同一上限，并同步契约；在接单前拒绝，不在运行时才失败 | `dispatch_input.go:198`、`businessaction/runtime.go:318` |
| 死代码 | 删除不检查租约的 `Complete`、`Fail` | `internal/kernel/taskqueue/store.go:395`、`:432` |

### W8 Loom 边界收口（W3 之后、W6 之前）

**原则：** 团队编排留在 Weave。Loom 内核是单跳、串行、确定性的，不承担团队并行派发、汇合和跨进程租约。单个成员的循环、检查点、重放和终态以 Loom 为准。Loom 与 Codex、Claude 等执行器站在同一个成员执行器端口后面：Weave 下发冻结的成员定义、输入、工具与预算，收回一个终态、产物、用量和恢复句柄。

**移交给 Loom**（通用机制，不带业务词汇，符合 Loom AGENTS.md 的分层规则）：

1. **日志重放的重建逻辑：** 由 Loom 在 `stdlib.ExecutionJournal` 契约内完成；Weave 只实现日志存储接口，像 `pgstore` 那样。`loomruntime/member_journal.go` 与 `member_run.go` 中的重建部分删除。
2. **提供方能力档案：** 由 Loom 提供方声明“工具历史中能否重放推理内容”等特性，并据此处理思考模式；删除 Weave `runtime_host_factory.go` 中按提供方 ID 字符串的判断。
3. **循环内预算：** 步数与 token 上限由 Loom 执行，到上限时停在检查点。跨成员、跨组织的额度预留与记账留在 Weave，收进一个包。
4. **唯一终态事件：** 每次成员运行由 Loom 的 `Terminalizer` 只发一个终态事件，Weave 只记录一次；这是 W6 的前提。

**Weave 内部收口：**

- 规格编译只留一条路径：冻结的团队定义 → `stdlib.AgentSpec` → Loom 编译。合并 `compiler`、`declarative`、`teamcompiler` 中重复的图构建；`app/api` 不再构建图或直接操作会话。
- 所有 Loom 调用经成员执行器端口（`loomadapter` / `runtimeprotocol`）。用 depguard 规则限定只有端口和 Loom 适配包能引用 `github.com/jinyitao123/loom`，由机器强制执行。
- 核对 Weave `memory`、`skills` 与 Loom `memstore`、`skilltool` 是否重复；这一项还没核对。

**2026-09-30 进展与核对（`weave-next` 分支 `rework/weave-platform-scope`）：**

- **已做：引用边界的机器检查。** 新增 `tools/loomimports`，随 `make depguard` 运行：统计各包直接引用 Loom 执行接口（`loom`、`stdlib`、`pgstore`、`provider/*`，不含共享词汇 `contract`）的文件数，基线为当前状态（33 个包、84 个文件）。新增引用的包、新增引用种类、文件数增加都会失败，移除后必须同步降低基线。原方案写的“只有端口和适配包能引用 Loom”现在不可能一步到位，因为 30 多个包已经直接引用，所以做成只减不增的检查，不是禁令。
- **已核对，无需合并：** ① Weave `memory`（向量语义记忆服务，依赖 PostgreSQL 与嵌入）与 Loom `memstore`（键值存储）是两回事，没有重叠；Weave `compiler/frozen_skills.go`（枚举冻结技能引用做依赖清单）与 Loom `stdlib/skilltool.go`（把技能当工具派发）在不同层，没有重叠。② `app/api` 里唯一的 `loom.NewGraph` 在 `runs.go`，只是为读取检查点历史而构造空图，不是构图，所以“app/api 不再构建图”实际已成立。③ 构图点共 7 处：`compiler`（1）、`declarative`（3）、`teamcompiler`（2）、`app/api/runs.go`（1，只读历史）；`teamcompiler` 服务的是团队互动装配，不是冻结流程的执行路径，是否与其余重复要在 W7 删除团队模板与建队之后再判断。
- **有意没做，原因如下：**
  1. **日志重放的重建逻辑移交 Loom。** `loomruntime/member_journal.go` 的 `operation()` 同时做位置寻址、输入摘要冲突、工具结果未知、丢失的模型响应重试计数、用量恢复和父运行事务围栏。把前三项抽成 Loom 的通用日志需要先设计围栏与用量的回调接口，否则会把 Weave 特有语义带进 Loom；这是对恢复核心的改写，而 W3 的矩阵目前只覆盖 Loom 一侧的契约，Weave 侧的真实运行数据（W2 的导出）还没拿到。应先用 W2 的回放在 124 的真实数据上跑一遍，确认现有实现的行为，再决定抽取范围。
  2. **提供方能力档案。** Loom 的 `WithThinkingControl` 已经承载“该提供方不能在工具历史里回放推理内容，所以带工具时关闭思考”这一能力，Weave `runtime_host_factory.go` 只是按 `system/deepseek` 这个冻结提供方标识选择它。把标识判断挪走需要在冻结绑定里增加提供方声明字段，属于契约变更，收益只是删掉一处三行判断，暂不做；改 Loom 只为此再同步一次 `third_party/loom` 也不值得。
  3. **循环内预算。** Loom 已有迭代上限与按模型轮次的切片控制（`ToolLoopControl`）；Weave `member_budget.go` 的令牌与费用累计依赖 Weave 的用量记账与跨成员额度，不是通用机制，不移交。
  4. **唯一终态事件。** 这是 W6 的前提，见 W6 探查；在 W6 落地前不单独动。

**验收：**

- W3 回归在收口前后都通过，W2 复现包中的运行回放结果不变。
- depguard 在引用越界时失败。
- 桌面创建、试跑、发布团队与员工交接在 124 实走不受影响。
- 同一流程中，一个 Loom 成员加一个 Codex 或 Claude 成员能经同一端口完成。

### W6 终态、谱系与用量合并（先探查，MVP1 验收后实施）

先写一份探查结论，补进本页：列出 `weave_run_terminal_markers`、`weave_workflow_member_runs`、`weave_run_attempt_leases`、`weave_team_run_activity_events` 和用量累计的全部写入方、写入时机和一致性依赖。目标是每次成员尝试只有一个写入方写一条终态，和任务完成放在同一事务提交；谱系在查询时推导，不再重建和修补（`terminal_v3_lineage_rebuild.go`、`terminal_lineage_repair.go`）。W2、W3 就绪且 W8 提供唯一终态事件之前，不动这部分代码。

**2026-09-30 探查结论（只读，未改代码）：**

写入方一览（生产代码，均在 `weave-next`）：

| 表 | 写入位置 | 说明 |
| --- | --- | --- |
| `weave_run_terminal_markers` | `loomruntime/terminal_marker_store.go` 中的 `ApplyTerminalMarkerTransition` 是唯一写入入口（一次插入、一次更新）；调用方共四处：正常终态协调 `normal_terminal_coordinator.go:328`、谱系修补 `terminal_lineage_repair.go:227`、团队运行终态 `teamrun/executor_terminal.go:562`，以及经 `terminal_sink.go` 的两种汇（单调汇、谱系汇）走同一入口 | 迁移校验 `ValidateTerminalMarkerTransition`（约 120 行）及一组等价与只差成本位的比较函数，负责保证单调、防倒退 |
| `weave_workflow_member_runs` | `loomruntime/member_run.go`（插入、写父代际、写成员结果）、`member_checkpoint.go`（写检查点序号） | 成员结果与终态标记不在同一处提交：`member_run.go` 的 `BeforeLock` 回调在终态提交事务里写结果，这一点已经是同一事务 |
| `weave_run_attempt_leases` | `attempt_lease_store.go`（登记、心跳、关闭、对账）与 `frozen_attempt.go`（冻结尝试的登记与更新） | 两个文件各有一套插入与更新 |
| `weave_team_run_activity_events` | `teamrun/activity.go` 单一 `Record` | 已经是单写入方 |
| 用量累计 | `loomruntime` 的用量累加器（`usage_*.go`）在检查点里保存，终态时由 `TerminalUsage` 带入标记 | 每个成员一个累加器，团队汇总在终态标记里 |

规模：`loomruntime` 中终态与生命周期相关的文件合计约 9,800 行（`run_registry.go` 1,620、`normal_terminal_coordinator.go` 796、`run_lifecycle_reader.go` 758、`terminal_attribution.go` 706、`terminal_v3.go` 646、`attempt_lease_lifecycle.go` 621、`run_lifecycle.go` 620、`terminal_marker_store.go` 613、`terminal_sink.go` 526、`terminal_v3_lineage.go` 436、`attempt_heartbeat.go` 436、`attempt_lease_store.go` 419、`frozen_attempt.go` 416、`a4_admission_receipt.go` 379、`terminal_lineage_repair.go` 296、`terminal_v3_lineage_rebuild.go` 275、`terminal_v3_assembler.go` 227）。

结论：

1. 终态标记与活动事件其实已经各有单一写入入口，问题不在“多个写入方”，而在**同一个终态有三条不同的产生路径**（成员正常终态、团队运行终态、谱系修补）各自组装候选、各自过同一套迁移校验，并且**谱系是先写后修补**：这里的谱系指用量沿父子关系的逐级汇总，每条终态记录只有本运行独占的用量，祖先记录里含子孙的用量由 `AssembleTerminalLineage` 在写入时汇总，汇总与实际不一致时由重建与修补程序（`terminal_v3_lineage_rebuild.go`、`terminal_lineage_repair.go` 共约 570 行）重新汇总。原方案“谱系在查询时推导”的方向成立：含子孙的用量可以在读取时由各运行的独占用量与父子边（`parent_run_id`、`aggregation_parent_run_id`）求和得出，不需要存储后再修补；但这只是读代码得出的设计判断，没有在真实数据上验证过汇总是否总能一致。
2. 但这是对恢复与对账核心的改写，涉及标记的迁移校验、`a4` 准入回执、心跳与租约生命周期，牵涉面约 9,800 行；`terminal_marker_store.go` 中大量的等价与倒退判断正是历史上各种半写状态留下的。在没有 W2 的真实运行数据和 124 上的对照之前，删除这些校验会失去对已存在数据的保护。
3. 建议的实施顺序（MVP1 验收后）：先在 124 用 `weave ops replay-run` 与终态标记读取，统计标记里 `lineage_state` 与 `audit_state` 的分布，确认有多少行依赖修补；再做“查询时推导谱系”的只读实现与现有存储并行对比，一致后才删除重建与修补；最后才合并三条终态产生路径，前提是 Loom 的 `Terminalizer` 对每次成员运行只发一个终态事件（W8 第 4 项）。这三步每一步都可以独立回退。
4. **本批不动这部分代码**，与原方案一致。

### W7 删除下线代码与重新分仓（MVP1 验收后）

1. W1 关闭满一个版本周期，并确认没有调用。
2. 把流程发布使用的产品发布代码从 `internal/app/teamconstruction` 移到发布相关的包；去掉 `agents.go` 对元团队成员名的引用。
3. 删除团队模板、建队运行与评测、元团队、网页 Workbench 代码，以及对应的 README、安装脚本和 Compose 内容。
4. 124 `default` 工作空间中的元团队数据，另行确认后清理。
5. 以 `weave-next` 为起点重新切分：不再设独立的网页 Workbench 仓，`weave-builder` 按保留的编排与恢复策略重新界定范围。

## 顺序与依赖

```text
W0 ─┬─ W1
    └─ W2 ─┬─ W3 ── W8 ──┐
           └─ W4 ── W5 ──┴─ MVP1 验收 ── W6 ── W7
```

- W0、W1 可以立即开始；W1 只改部署和路由注册，不影响执行路径。
- W2 是 W3、W4 以及之后所有运行时改动的验证前提。
- W8 在 W3 回归就绪后开始，W6 依赖 W8 提供的唯一终态事件。W8 中“Weave 内部收口”的去重可以与 W4、W5 并行，但移交给 Loom 的部分须等 W3。
- 跨组件的委托问题（C15、C16）和 Forge、桌面侧问题（C18–C24）按问题清单单独排期；W4 与 C21 的持久操作身份、系统幂等参数及原回执恢复已按共享契约实现，验证与发布状态见项目状态。

## 执行环境

方案初审来自 Windows 主机；2026-10-01 整合在已有 macOS 工作树执行，本机具备 Go、Node 和隔离 PostgreSQL。代码类工作包在已有 `weave-next` 与 Loom 源码的 macOS 开发机上执行；每个工作包完成后，在 `weave-next` 形成提交并通过 `make test depguard base-depguard productguard`，再按正常方式同步总仓组件锁。
