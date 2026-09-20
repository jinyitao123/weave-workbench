# 当前项目状态

更新：2026-09-20。接手先执行 `make status`；本页是工作摘要，不是线上实时状态。

## 当前目标与边界

按[MVP1 方案](plans/mvp1.md)完成员工合同交接与开发者修改发布两类闭环，按[落地步骤](plans/mvp1-delivery.md)推进。当前先核对组件来源，再补身份、团队可视与业务交接。架构以[产品基线](architecture/product-architecture.md)为准，跨仓按[同步规则](architecture/delivery-model.md)执行。

## 已有成果与证据边界

- 桌面工作空间、材料/成果目录、自选文件夹与双服务健康展示已有实现；历史验证见[桌面壳层验收](acceptance/2026-09-20-desktop-workspace-shell.md)。本轮未重跑桌面全量测试。
- `contracts/v1` 已改为 Forge 账号、Weave 自动绑定与任务委托边界；旧的 OAuth 与五项能力投影已从当前方案撤回。
- Forge 当前主线 `cfe4d442` 已同步进总仓；其中已有大量业务页面与动作进展，但统一登录、自动绑定、真实团队执行和跨员工业务闭环仍须按本方案重新验收。
- 前一会话曾进行远端 Weave 部署和数据库字段修复；本轮仅检查本地仓库，线上版本、运行时及修复生效情况待复核。环境记录见[联调环境](environments/development.md)。

## 工作队列

| ID | 工作 / 归属 | 状态 | 下一步与完成判据 |
| --- | --- | --- | --- |
| ENG-01 | 架构和接手规范 / 总仓 | 完成 | 本地文档、入口检查、4 项工具回归通过；见[本轮证据](acceptance/2026-09-20-engineering-baseline.md)，远端共享另见 ENG-02 |
| PLAN-01 | MVP1 验收目标和落地步骤 / 总仓 | 完成 | 已保存[验收方案](plans/mvp1.md)和[执行顺序](plans/mvp1-delivery.md)；仅方案归档，不代表功能实现 |
| SYNC-01 | Weave 健康观察修复回流 / weave-next → 总仓 | 完成 | 独立 Weave 提交 `a80b466b` 通过包测试、真实 PostgreSQL 回归与依赖守卫；总仓锁定并提交为 `507e6245`，组件检查一致 |
| ENG-02 | 总仓远端与共享基线 / 总仓 | 待开始 | 本轮核对尚无远端；确定并配置远端，先整理原有未提交成果的归属，再提交共享；推送与 CI 成功另留证据 |
| ENV-01 | Forge 账号接入 / Forge、Workbench | 已实现组件切片 | Workbench PR #1 已改为一次 Forge 账号密码登录并换取 Weave 会话；仍需在部署环境验证真实 Forge 会话接口 |
| ACCESS-01 | Weave 自动绑定与三类角色 / Weave、Workbench | 已实现组件切片 | Weave PR #5 已实现 `issuer + subject + organization` 持久绑定、首次创建 `member`、重复登录保留现有角色，并移除外部权限引擎；仍缺真实 PostgreSQL 与三角色端到端验收 |
| OBS-01 | 团队配置与执行可见 / 总仓、Weave | 待开始 | 在 ENV-01 基础上接入团队详情、关系图和真实运行记录；开发者能从任务追到版本、节点和失败原因 |
| FLOW-01 | 合同材料到跨员工待办 / 三仓 | 待开始 | 在 ENV-01、OBS-01 基础上按[销售场景](../scenarios/sales-contract-handoff/README.md)推进；业务写回并由独立身份读回才算通过 |
| DEV-01 | 团队与应用修改、测试、发布 / 三仓 | 待开始 | 员工路径贯通后，完成团队草稿、两类调试、一次 Forge 变更与版本发布；员工实际用到新能力 |
| ACCEPT-01 | MVP1 组合验收 / 总仓 | 待开始 | 按 MVP1 验证正常与异常路径、安装重开和版本证据；必需项全部通过后完成 |

ENG-01、PLAN-01 由本次“梳理会话接入与主架构”会话完成。SYNC-01 已形成独立组件提交与总仓集成提交；ENV-01 和 ACCESS-01 已形成组件 PR，组件检查通过不等于跨系统登录已经验收。其余条目尚未领取，不代表后台正在执行。

## 未提交现场与组件偏差

当前基线：分支 `codex/product-shell`，账号边界与 Forge 来源同步由提交 `06871965` 留档。桌面产品壳层仍有未提交改动；本轮只撤回其中账号权限接入部分并保留工作空间、开发入口等无关成果。完整清单以 `make status` 为准。

Weave 的回流结果为：

- `platform/weave/internal/kernel/workflowhealth/store.go`：健康观察查询从旧字段 `build_run_id` 改用 `candidate_content_hash`。
- `platform/weave/internal/kernel/workflowhealth/store_pg_test.go`：真实 PostgreSQL 回归用例随修复进入提交。

独立 Weave 工作树 `/Users/jinyitao/Developer/weave-next-workflow-health-fix` 保存提交 `a80b466b`，尚未推送；原 `/Users/jinyitao/Developer/weave-next` 的其他未提交工作未被改动。

独立 Weave 工作树 `/Users/jinyitao/Developer/weave-next-product-access` 的 [weave-next PR #5](https://github.com/jinyitao123/weave-next/pull/5) 已更新为 Forge 账号自动绑定和 Weave 原生三类角色，当前提交 `b9db21a2`。Cerbos、五项权限投影和固定开发者名单已移除，角色更新只接受 `member / developer / admin`。

独立 Workbench 工作树 `/Users/jinyitao/Developer/weave-workbench-product-access-upstream` 的 [weave-workbench PR #1](https://github.com/jinyitao123/weave-workbench/pull/1) 已更新为一次 Forge 登录与 Weave 会话交换，提交 `a4623cf0`。界面只呈现 Weave 角色，开发者不自动获得 Host 运维权限。

独立 Forge 工作树 `/Users/jinyitao/Developer/inoForge-workbench-oauth` 已用提交 `bea0706` 撤回 OAuth 试验，inoForge PR #1 已关闭。总仓 `platform/forge` 已恢复并锁定 inoForge 主线提交 `cfe4d442`；inoForge 主工作树仍有 86 项未提交页面与验收材料，未经过页面证据门禁，不直接复制进总仓。

ObjectStack HTTP OAuth 草稿 PR #19342 不再属于 MVP1 依赖。是否关闭外部草稿 PR 由对应上游仓库单独处理；当前总仓已移除补丁和相关配置。

## 下一会话第一步

执行 `make status`，核对上述现场；部署 PR #1 与 PR #5 的组合环境，验证首次创建、重复读回、角色调整不被覆盖和停用拒绝。通过后进入 OBS-01，不再扩展权限模型。
