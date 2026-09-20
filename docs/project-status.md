# 当前项目状态

更新：2026-09-20。接手先执行 `make status`；本页是工作摘要，不是线上实时状态。

## 当前目标与边界

按[MVP1 方案](plans/mvp1.md)完成员工合同交接与开发者修改发布两类闭环，按[落地步骤](plans/mvp1-delivery.md)推进。当前先核对组件来源，再补身份、团队可视与业务交接。架构以[产品基线](architecture/product-architecture.md)为准，跨仓按[同步规则](architecture/delivery-model.md)执行。

## 已有成果与证据边界

- 桌面工作空间、材料/成果目录、自选文件夹与双服务健康展示已有实现；历史验证见[桌面壳层验收](acceptance/2026-09-20-desktop-workspace-shell.md)。本轮未重跑桌面全量测试。
- `contracts/v1` 已补企业会话投影与安全边界；执行控制、响应错误和取消等约定尚未完整落地，不能视作全部接口已实现。
- Forge 登录、统一身份委托、真实团队执行和跨员工业务闭环尚未完成本产品验收。
- 前一会话曾进行远端 Weave 部署和数据库字段修复；本轮仅检查本地仓库，线上版本、运行时及修复生效情况待复核。环境记录见[联调环境](environments/development.md)。

## 工作队列

| ID | 工作 / 归属 | 状态 | 下一步与完成判据 |
| --- | --- | --- | --- |
| ENG-01 | 架构和接手规范 / 总仓 | 完成 | 本地文档、入口检查、4 项工具回归通过；见[本轮证据](acceptance/2026-09-20-engineering-baseline.md)，远端共享另见 ENG-02 |
| PLAN-01 | MVP1 验收目标和落地步骤 / 总仓 | 完成 | 已保存[验收方案](plans/mvp1.md)和[执行顺序](plans/mvp1-delivery.md)；仅方案归档，不代表功能实现 |
| SYNC-01 | Weave 健康观察修复回流 / weave-next → 总仓 | 完成 | 独立 Weave 提交 `a80b466b` 通过包测试、真实 PostgreSQL 回归与依赖守卫；总仓锁定并提交为 `507e6245`，组件检查一致 |
| ENG-02 | 总仓远端与共享基线 / 总仓 | 待开始 | 本轮核对尚无远端；确定并配置远端，先整理原有未提交成果的归属，再提交共享；推送与 CI 成功另留证据 |
| ENV-01 | 组织环境接入与统一身份 / 三仓 | 进行中 | 内网 HTTP 的发现、动态注册、浏览器授权、回环、令牌交换和 UserInfo 已用真实管理员会话通过；UserInfo 尚未返回组织与角色，ObjectStack 17.4.0 默认关闭非本机 HTTP 的 MCP OAuth，`issuer` 仍与 HTTP 入口不一致。原生 HTTP 开关已提交 ObjectStack 草稿 PR #19342，inoForge 部署参数在 PR #1；待上游检查、运行镜像和 MCP 权限与多角色验收 |
| ACCESS-01 | 接入与产品权限 / 总仓、Weave | 进行中 | 三份 v1 契约、桌面五项能力与原因展示、Weave 原生能力投影已实现并通过组件检查，见[实现记录](acceptance/2026-09-20-product-access-projection.md)。下一步完成 Forge OAuth 身份到 Weave 身份的受控适配，再用员工、开发者账号做桌面验收 |
| OBS-01 | 团队配置与执行可见 / 总仓、Weave | 待开始 | 在 ENV-01 基础上接入团队详情、关系图和真实运行记录；开发者能从任务追到版本、节点和失败原因 |
| FLOW-01 | 合同材料到跨员工待办 / 三仓 | 待开始 | 在 ENV-01、OBS-01 基础上按[销售场景](../scenarios/sales-contract-handoff/README.md)推进；业务写回并由独立身份读回才算通过 |
| DEV-01 | 团队与应用修改、测试、发布 / 三仓 | 待开始 | 员工路径贯通后，完成团队草稿、两类调试、一次 Forge 变更与版本发布；员工实际用到新能力 |
| ACCEPT-01 | MVP1 组合验收 / 总仓 | 待开始 | 按 MVP1 验证正常与异常路径、安装重开和版本证据；必需项全部通过后完成 |

ENG-01、PLAN-01 由本次“梳理会话接入与主架构”会话完成。SYNC-01 已形成独立组件提交与总仓集成提交；ENV-01 的桌面切片仍在本地工作树，尚未提交/推送。其余条目尚未领取，不代表后台正在执行。

## 未提交现场与组件偏差

当前基线：分支 `codex/product-shell`，HEAD `20ccbb716542ebeca5691fb6027dbefc2322018e`。已存在桌面源码/测试、README、架构/环境/验收说明和结构检查工具的未提交改动；不得清理或混入无关组件提交。完整清单以 `make status` 为准。

Weave 的回流结果为：

- `platform/weave/internal/kernel/workflowhealth/store.go`：健康观察查询从旧字段 `build_run_id` 改用 `candidate_content_hash`。
- `platform/weave/internal/kernel/workflowhealth/store_pg_test.go`：真实 PostgreSQL 回归用例随修复进入提交。

独立 Weave 工作树 `/Users/jinyitao/Developer/weave-next-workflow-health-fix` 保存提交 `a80b466b`，尚未推送；原 `/Users/jinyitao/Developer/weave-next` 的其他未提交工作未被改动。

独立 Weave 工作树 `/Users/jinyitao/Developer/weave-next-product-access` 以提交 `5772c2d8` 实现五项产品能力投影，已推送至草稿 [weave-next PR #5](https://github.com/jinyitao123/weave-next/pull/5)。`make test`、依赖边界与产品边界检查通过；当前仍需完成身份适配，组件接口通过不等于桌面真实账号已接通。

独立 Forge 工作树 `/Users/jinyitao/Developer/inoForge-workbench-oauth` 保存 OAuth 配置提交 `8235e9ee`、内网 HTTP 说明 `d7398b4d` 和默认关闭的部署开关 `d89c793`，已推送到 `codex/workbench-oauth` 并建立 inoForge PR #1；`typecheck`、`validate` 和 `build` 通过。原 `/Users/jinyitao/Developer/inoForge` 的其他未提交工作未被改动，线上仍未部署这些提交。

ObjectStack 17.4.0 的原生 HTTP OAuth 补丁保存在 [HTTP OAuth 补丁](engineering/objectstack-intranet-http-oauth.patch)，提交 `5fa7b6dc` 已形成 [草稿 PR #19342](https://github.com/objectstack-ai/objectstack/pull/19342)。按当前决定，该方案暂停，不再作为后续产品权限工作的前置条件；完整仓库 CI、typecheck、build 和镜像仍未完成。

## 下一会话第一步

执行 `make status`，核对上述现场；继续 ACCESS-01：完成 Forge OAuth 身份到 Weave 身份的受控适配，用员工和开发者账号验证五项能力与原因；随后为一条真实团队任务增加短期委托，并接一个 Forge 合同交接动作验证双重权限判断。ObjectStack HTTP OAuth 方案保持暂停。
