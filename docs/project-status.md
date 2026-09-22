# 当前项目状态

更新：2026-09-22。接手先执行 `make status`；本页是工作摘要，不是线上实时状态。

## 当前目标与边界

2026-09-21 基线纠偏：用户明确 MVP1 使用 GooeyPi，即本仓 `desktop/`。此前启动的 `weave-workbench-product-access-upstream/apps/desktop` 属于旧 DSH/Host 基线，登录页面展示不计入 MVP1 桌面成果。保留已有代码作参考，后续统一登录和开发者可视化回到 GooeyPi 实现。

按[MVP1 方案](plans/mvp1.md)完成员工合同交接与开发者修改发布两类闭环，按[落地步骤](plans/mvp1-delivery.md)推进。完整业务范围见[OTC 业务主流程](architecture/otc-business-flow.md)，首个实现与验收范围固定为[销售、交付负责人、商务财务三人合同接力](../scenarios/sales-contract-handoff/README.md)。架构以[产品基线](architecture/product-architecture.md)为准，跨仓按[同步规则](architecture/delivery-model.md)执行。

## 已有成果与证据边界

- 桌面工作空间、材料/成果目录、自选文件夹与双服务健康展示已有实现；历史验证见[桌面壳层验收](acceptance/2026-09-20-desktop-workspace-shell.md)。本轮未重跑桌面全量测试。
- `contracts/v1` 已改为 Forge 账号、Weave 自动绑定与任务委托边界；旧的 OAuth 与五项能力投影已从当前方案撤回。
- Forge 主线 `0e0962c2` 已同步进总仓并以固定镜像部署；该版本包含合同岗位审批流、“提交审批”业务动作和不授予业务数据权限的“智能体团队开发”权限集。ObjectStack 原生岗位、业务单元和员工任职已在重启后稳定读回，岗位标识可通过正式数据接口解析到真实员工；见[岗位路由底层验证](acceptance/2026-09-21-objectstack-position-routing-foundation.md)。统一登录、真实团队执行和跨员工业务闭环仍须按本方案继续验收。
- 当前 Weave 已部署 `0b2b79ff`，整团队草稿、候选调试及原子激活接口已进入组件；桌面编辑器仍在本工作树修改，按用户最新要求改为显式保存。远端模型已接入 DeepSeek，当前团队曾从桌面选择 `deepseek-flash`；具体运行是否使用以每次运行记录为准。环境事实见[环境说明](environments/development.md)，本轮编辑器证据与缺口见[DEV-02](acceptance/2026-09-22-team-workspace-editor.md)。

## 工作队列

| ID | 工作 / 归属 | 状态 | 下一步与完成判据 |
| --- | --- | --- | --- |
| ENG-01 | 架构和接手规范 / 总仓 | 完成 | 本地文档、入口检查、4 项工具回归通过；见[本轮证据](acceptance/2026-09-20-engineering-baseline.md)，远端共享另见 ENG-02 |
| PLAN-01 | MVP1 验收目标和落地步骤 / 总仓 | 完成 | 已保存[验收方案](plans/mvp1.md)和[执行顺序](plans/mvp1-delivery.md)；仅方案归档，不代表功能实现 |
| SYNC-01 | Weave 健康观察修复回流 / weave-next → 总仓 | 完成 | 独立 Weave 提交 `a80b466b` 通过包测试、真实 PostgreSQL 回归与依赖守卫；总仓锁定并提交为 `507e6245`，组件检查一致 |
| ENG-02 | 总仓远端与共享基线 / 总仓 | 完成 | GooeyPi 已成为 `main` 和 `codex/product-shell` 的桌面基线，旧 DSH 分支与工作树已清理；当前继续在 GooeyPi 上推进 MVP1 |
| ENV-01 | Forge 账号接入 / Forge、GooeyPi 桌面 | 通过 | 真实 Forge 账号已完成一次登录、Weave 会话交换、系统安全存储、进程重开恢复和退出边界验证；见[登录验收](acceptance/2026-09-21-gooeypi-mvp1-login.md) |
| ACCESS-01 | Forge 权限验证与 Weave 自动绑定 / Forge、Weave、Workbench | 通过 | 开发账号可从桌面进入开发中心，普通员工无入口且命令面板无对应命令；临时把普通员工的 Weave 旧角色改为 `admin` 后结果不变并已恢复，Forge 页面独立读回“智能体团队开发”；见[权限验收](acceptance/2026-09-22-forge-team-development-access.md) |
| OBS-01 | 团队配置与执行可见 / 总仓、Weave | 进行中 | 桌面已读到合同流程正式版 6；真实运行虽成功终结，成果却无依据声称缺项补齐。当前缺逐步运行查看和同材料试运行入口，见[本轮证据](acceptance/2026-09-22-handoff-reliability-and-team-development.md) |
| FLOW-01 | 材料交接、结果通知与员工续办 / 三仓 | 进行中 | 已补账号与当前轮次绑定、UUID、受保护固定提交包和恢复；桌面实跑文本合同交接、重开后同请求恢复、缺文件未提交通过。已确认 ObjectStack 原生审批请求、修订退回、重新提交和收件箱可以承接员工续办，删除平行的通用事项对象/webhook；桌面“我的工作”已合并读取并办理原生审批。Forge 已显式启用审批能力和 MCP 服务，合同提交动作受权限约束。下一步接通 Weave 受限委托、真实合同文件读取和团队业务动作，再从桌面完成团队退回、人工退回和正式通过；完整链路未通过 |
| DEV-01 | 团队与应用修改、测试、发布 / 三仓 | 进行中 | 整团队草稿与调试接口已部署，桌面原位编辑、显式保存、节点添加与离开保护已实现；实际已创建非合同团队并保存成员和流程，成员重新进入读回通过。第一批删除和流程重开仍待验收；随后完成两类团队的调试和更新；外部工具隔离、结构化输入和实际 Loom 图仍缺，见 DEV-02 证据 |
| ACCEPT-01 | MVP1 组合验收 / 总仓 | 待开始 | 按 MVP1 验证正常与异常路径、安装重开和版本证据；必需项全部通过后完成 |

ENG-01、PLAN-01 由本次“梳理会话接入与主架构”会话完成。SYNC-01 已形成独立组件提交与总仓集成提交；ENV-01 和 ACCESS-01 已形成组件 PR，组件检查通过不等于跨系统登录已经验收。其余条目尚未领取，不代表后台正在执行。

## 未提交现场与组件偏差

本轮工作分支为 `codex/reliable-team-handoff`。Weave 锁定 `bd6ee7c0` 且来源一致。Forge 源码主仓 `3a451067` 已删除平行员工事项试验，启用原生审批与 MCP，并同步到总仓版本锁；桌面已接原生审批读取、退回修改和重新提交。保留未跟踪场景账号文件，本轮不读取或修改。当前仍是本地实现与工程验证，尚未重新部署或完成跨员工业务验收。

Weave 的回流结果为：

- `platform/weave/internal/kernel/workflowhealth/store.go`：健康观察查询从旧字段 `build_run_id` 改用 `candidate_content_hash`。
- `platform/weave/internal/kernel/workflowhealth/store_pg_test.go`：真实 PostgreSQL 回归用例随修复进入提交。

2026-09-21 已完成本地分支和工作树收拢。Weave 的账号接入、团队配置草稿、运行时修复、MCP 修复及历史智能体能力已进入源码主仓；Forge 页面成果和已撤回的 OAuth 试验历史已进入源码主仓；总仓已重新同步并通过组件一致性检查。详情见[分支与工作树收拢记录](acceptance/2026-09-21-branch-worktree-consolidation.md)。远端推送、重新部署和业务闭环仍分别验收，不由本次本地收拢代替。

ObjectStack HTTP OAuth 草稿 PR #19342 不再属于 MVP1 依赖。是否关闭外部草稿 PR 由对应上游仓库单独处理；当前总仓已移除补丁和相关配置。

## 当前推进点

2026-09-22 已将[运行反馈、业务动作与续办设计](architecture/product-architecture.md#运行反馈业务动作与员工续办)写入统一架构。首批按[MVP1 完整业务流](plans/mvp1.md#当前先交付第一条完整业务流)收敛到合同正式评审通过：开发者桌面绑定能力，销售交付实际文件，团队退回、销售修改，进入交付/商务人工复核，人工退回后再修改并通过，最后独立读回。

下一步按[落地步骤](plans/mvp1-delivery.md)完成 Weave 到 Forge MCP 的受限身份委托、合同文件读取和能力目录绑定。运行反馈由系统自动提供，不要求每团队配置通知工具；业务退回继续使用 Forge 原生审批修订环，不使用终态投递目标承载。

已核实当前能力绑定的具体断点：桌面能从 Forge MCP 读取 `list_actions`，成员草稿也会保存 `business_capability_ids`，但 Weave 发布与执行阶段没有消费这些标识，既不会生成冻结 MCP 绑定，也没有员工级 Forge 委托凭据。当前字段只是配置记录，不能据此声称团队已经获得业务动作；下一批必须在 Weave 编译发布阶段解析能力标识，并把本次员工、组织、材料版本和允许动作绑定成短期执行授权。

本轮已完成原生审批与桌面待办的第一批本地实现，业务链路仍未通过。D5 完整隔离调试、D6 Forge 应用修改留在首个业务闭环后的 MVP1 开发验收批次。首个闭环需要的受限委托、真实文件和团队业务动作继续前置，不能再以“Forge 以后再接”留下半条业务流。历史实现和失败证据见[本轮验收记录](acceptance/2026-09-22-handoff-reliability-and-team-development.md)。
