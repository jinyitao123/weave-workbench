# 当前项目状态

更新：2026-09-21。接手先执行 `make status`；本页是工作摘要，不是线上实时状态。

## 当前目标与边界

2026-09-21 基线纠偏：用户明确 MVP1 使用 GooeyPi，即本仓 `desktop/`。此前启动的 `weave-workbench-product-access-upstream/apps/desktop` 属于旧 DSH/Host 基线，登录页面展示不计入 MVP1 桌面成果。保留已有代码作参考，后续统一登录和开发者可视化回到 GooeyPi 实现。

按[MVP1 方案](plans/mvp1.md)完成员工合同交接与开发者修改发布两类闭环，按[落地步骤](plans/mvp1-delivery.md)推进。当前先核对组件来源，再补身份、团队可视与业务交接。架构以[产品基线](architecture/product-architecture.md)为准，跨仓按[同步规则](architecture/delivery-model.md)执行。

## 已有成果与证据边界

- 桌面工作空间、材料/成果目录、自选文件夹与双服务健康展示已有实现；历史验证见[桌面壳层验收](acceptance/2026-09-20-desktop-workspace-shell.md)。本轮未重跑桌面全量测试。
- `contracts/v1` 已改为 Forge 账号、Weave 自动绑定与任务委托边界；旧的 OAuth 与五项能力投影已从当前方案撤回。
- Forge 当前主线 `6e25449b` 已同步进总仓并部署到联调服务器；本批包含销售与行政页面休整、页面门禁、脱敏证据和生产字段约束对齐，114 个清单条目仍保持 `review_required`。销售订单新建、设备维护和资质申报已完成登录态线上可见性检查；统一登录、真实团队执行和跨员工业务闭环仍须按本方案重新验收。
- 线上 Weave 当前部署 `main@73e79583`。真实 Forge 开发账号已自动绑定；桌面已从空状态新建真实团队，完成成员配置应用，并从流程草稿检查、发布到下一版草稿迭代。证据见[Weave 干净重部署记录](acceptance/2026-09-21-weave-clean-redeployment.md)。

## 工作队列

| ID | 工作 / 归属 | 状态 | 下一步与完成判据 |
| --- | --- | --- | --- |
| ENG-01 | 架构和接手规范 / 总仓 | 完成 | 本地文档、入口检查、4 项工具回归通过；见[本轮证据](acceptance/2026-09-20-engineering-baseline.md)，远端共享另见 ENG-02 |
| PLAN-01 | MVP1 验收目标和落地步骤 / 总仓 | 完成 | 已保存[验收方案](plans/mvp1.md)和[执行顺序](plans/mvp1-delivery.md)；仅方案归档，不代表功能实现 |
| SYNC-01 | Weave 健康观察修复回流 / weave-next → 总仓 | 完成 | 独立 Weave 提交 `a80b466b` 通过包测试、真实 PostgreSQL 回归与依赖守卫；总仓锁定并提交为 `507e6245`，组件检查一致 |
| ENG-02 | 总仓远端与共享基线 / 总仓 | 完成 | GooeyPi 已成为 `main` 和 `codex/product-shell` 的桌面基线，旧 DSH 分支与工作树已清理；当前继续在 GooeyPi 上推进 MVP1 |
| ENV-01 | Forge 账号接入 / Forge、GooeyPi 桌面 | 通过 | 真实 Forge 账号已完成一次登录、Weave 会话交换、系统安全存储、进程重开恢复和退出边界验证；见[登录验收](acceptance/2026-09-21-gooeypi-mvp1-login.md) |
| ACCESS-01 | Weave 自动绑定与三类角色 / Weave、Workbench | 通过当前管理员路径 | 真实 PostgreSQL 中首次绑定、重复登录稳定读回和管理员角色保留已验证；`member` 无法从命令入口进入开发中心；三名独立真实账号矩阵仍纳入 ACCEPT-01 |
| OBS-01 | 团队配置与执行可见 / 总仓、Weave | 进行中 | 开发中心为“顶部团队切换 + 左侧成员/流程画布 + 右侧完整编辑区”；成员草稿可保存和应用，技能支持手动输入与文件导入。桌面已完成流程步骤新增、修改、移除、检查、发布及已发布版本进入下一版草稿。仍需补团队归档、第二执行成员与并行流程的真实配置和执行验证 |
| FLOW-01 | 合同材料到跨员工待办 / 三仓 | 进行中 | 已从原生桌面以管理员发起工作，再退出到独立登录首页并以第二个 Forge 账号登录、读取待办、填写意见和确认接收；运行 `run-13f7d179-6dae-5cde-8581-c722cef51c2c` 从桌面刷新后显示成功。材料上传、Forge 业务动作与浏览器业务结果读回、文件成果尚未完成 |
| DEV-01 | 团队与应用修改、测试、发布 / 三仓 | 待开始 | 员工路径贯通后，完成团队草稿、两类调试、一次 Forge 变更与版本发布；员工实际用到新能力 |
| ACCEPT-01 | MVP1 组合验收 / 总仓 | 待开始 | 按 MVP1 验证正常与异常路径、安装重开和版本证据；必需项全部通过后完成 |

ENG-01、PLAN-01 由本次“梳理会话接入与主架构”会话完成。SYNC-01 已形成独立组件提交与总仓集成提交；ENV-01 和 ACCESS-01 已形成组件 PR，组件检查通过不等于跨系统登录已经验收。其余条目尚未领取，不代表后台正在执行。

## 未提交现场与组件偏差

当前本地基线已收拢到总仓 `main`；GooeyPi 登录、权限边界和团队成员配置草稿均进入该组合版本。当前工作树与组件偏差以 `make status` 为准。

Weave 的回流结果为：

- `platform/weave/internal/kernel/workflowhealth/store.go`：健康观察查询从旧字段 `build_run_id` 改用 `candidate_content_hash`。
- `platform/weave/internal/kernel/workflowhealth/store_pg_test.go`：真实 PostgreSQL 回归用例随修复进入提交。

2026-09-21 已完成本地分支和工作树收拢。Weave 的账号接入、团队配置草稿、运行时修复、MCP 修复及历史智能体能力已进入源码主仓；Forge 页面成果和已撤回的 OAuth 试验历史已进入源码主仓；总仓已重新同步并通过组件一致性检查。详情见[分支与工作树收拢记录](acceptance/2026-09-21-branch-worktree-consolidation.md)。远端推送、重新部署和业务闭环仍分别验收，不由本次本地收拢代替。

ObjectStack HTTP OAuth 草稿 PR #19342 不再属于 MVP1 依赖。是否关闭外部草稿 PR 由对应上游仓库单独处理；当前总仓已移除补丁和相关配置。

## 当前推进点

先补齐内联技能进入已发布运行包，并完成第二执行成员与并行流程的桌面验证；随后接入 Forge 合同交接业务动作和浏览器独立读回。桌面流程检查与发布不能代替 Forge 业务结果。
