# 委外样板与 RISEMAP 并排对照

对照日期：2026-09-13
Forge 基线：`main`，提交 `c27e2c6`
RISEMAP 基线：已保存的当前页面证据 RM-087、RM-093，以及委外回厂/NCR 证据。  
对照范围：页面结构、岗位入口、来源关系、状态动作、结果字段和阻断反馈。只读证据不被解释为 RISEMAP 写入成功证据。

## 对照矩阵

| 对照项 | RISEMAP 已观察 | Forge 当前实现 | 判定 |
| --- | --- | --- | --- |
| 一级区域 | 委外入口位于“生产 → 委外管理” | `objectstack.config.ts` 位于“生产 → 委外管理” | 结构一致 |
| 看板待办入口 | RM-082 的进行中、待发料、待回厂、待对账指标可点击进入对应业务入口 | Forge 四个指标卡均可点击；待对账进入 `page_subcontract_reconciliation`，待发料/待回厂进入对应岗位页 | 行为已补齐；实际样本数量仍随数据库状态变化 |
| 发料状态入口 | RM-084 的全部发料单、待审核、待发料、待签收指标可筛选列表 | Forge 四个指标卡直接驱动状态筛选，点击后保持选中态并可恢复全部 | 浏览器已验证；真实发料样本的状态数量仍随数据库状态变化 |
| 委外库存入口 | RM-089 独立“委外厂库存”工作台，支持供应商/物料视角、账龄筛选、超 30 天入口和“去发料” | `page_subcontract_stock` 独立业务页面；原 `forge_subcontract_stock_balance` 对象保留为数据底座 | 浏览器已验证入口、视角、账龄筛选和去发料路径；账龄起算口径仍是 Forge 工程推断 |
| 委外未交入口 | RM-091 独立“委外未交明细表”，按加工件行展示未交、交期、超期、供应商和工艺筛选 | `page_subcontract_undelivered` 独立只读业务报表；从订单与订单加工件计算未交量，行级返回委外订单上下文 | 浏览器已验证首屏、空状态、超期切换和 Console 供应商筛选；当前独立库无未交样本，真实行级回跳与金额样本待补证 |
| 批次追溯入口 | RM-090 独立“委外批次追溯”，支持材料批次正向召回和成品批号反向定位材料 | `page_subcontract_trace` 独立只读追溯工具；读取发料批次、回厂批次和耗用记录，支持模式切换、查询和导出 | 浏览器已验证模式切换、输入语义、空结果和导出禁用；当前模型缺少材料批次到成品批次的直接明细关联，结果按订单+物料聚合并标记“未登记”，真实样本待复核 |
| 委外进货入口 | RM-092 独立“委外进货明细表”，按回厂物料行展示回厂量、良品、不良、良率、加工费、仓库、批次、检验员和状态 | `page_subcontract_inbound_report` 独立只读报表；复用回厂明细并关联订单、供应商、入库明细和仓库，支持搜索、供应商、日期、不良筛选、导出及上下文回跳 | 浏览器已验证首屏字段、空状态、搜索、不良筛选和生产菜单路由；当前独立库无回厂样本，真实金额、良率、仓库和订单回跳待补证 |
| 委外退料入口 | RM-086 “委外退料”列表含有效退料单、待入库、已入库 KPI；新建单登记甲供料订单余量和退料原因，确认后生成待入库单 | `page_subcontract_return_workspace` 按列表、草稿、待入库三个岗位节点办理；服务端阻断包工包料、超在外余量、重复确认，并在入库后回写委外余额、累计退料和 `material_return` 流水 | 本地真实材料链、浏览器页面和同库重启已验证；RISEMAP 当前线上写入、供应商外部确认、赔偿语义仍待复核 |
| 委外结算入口 | RM-087 独立“委外对账”入口 | `page_subcontract_reconciliation` 独立页面 | 结构一致 |
| 结果报表入口 | RM-093 独立“委外对账单”结果页 | `page_subcontract_reconciliation_report` 独立页面 | 结构一致 |
| 待办聚合维度 | 待对账池按供应商、订单、回厂批次聚合 | Forge 按可结算回厂批次列出供应商、订单、批次、良品数量和加工费 | 结构一致；聚合细节仍待同材料复核 |
| 合并关系 | 已保存证据显示多个回厂批次可合并为一张对账单 | 页面允许勾选多个批次生成一张对账单 | 行为实现，RISEMAP 同材料写入仍待复核 |
| 结算资格 | 页面和指南证据指向已入库且尚未对账的来源 | Forge 还要求入库完成、NCR 已执行且来源未被占用 | Forge 有额外阻断；是否与 RISEMAP 完全一致待复核 |
| 费用展示 | RM-093 展示加工费、补料、扣款、应付 | Forge 展示相同费用列及来源行 | 字段结构一致 |
| 应付公式 | 已观察口径为加工费 + 补料 − 扣款 | Forge 首版按该公式计算，未接入的费用明确为零值 | 公式一致；来源分配待复核 |
| 状态 | RM-087/RM-093 至少有待确认、已确认、已生成应付、已作废 | Forge 映射为 `pending_confirmation`、`confirmed`、`payable_generated`、`voided` | 状态集合一致；动作语义待复核 |
| 来源穿透 | RISEMAP 页面展示订单、回厂批次和费用信息 | Forge 对账单展示订单、回厂单和金额来源行；订单上下文还显示 NCR 和入库 | Forge 信息更完整；不代表 RISEMAP 页面等价 |
| 异常阻断 | 已保存证据未证明未入库/NCR 的完整写入阻断路径 | Forge 页面保留异常批次并显示阻断原因及下一步 | Forge 工程实现，RISEMAP 待复核 |
| 订单上下文 | 委外订单、发料、回厂、质量和结算入口分属委外任务；退料结果回到委外业务链 | Forge 用订单上下文串联订单、发料、回厂、质量、退料和结算入口，并显示退料状态、待入库结果和下一步 | 任务结构对齐；RISEMAP 连续写入和退料回链未证明 |
| 确认动作 | 当前 RISEMAP 证据未能证明内部确认、供应商确认和应付生成的拆分 | Forge 首版为“确认锁定”后“生成应付” | 明确差异，保留待决策 |
| 部分结算/差异 | 当前证据未证明 | Forge 未实现部分确认、重开、拆分和差异关闭 | 未实现且正确保留待复核 |

## 证据索引

RISEMAP：

- RM-087 待对账池：`docs/references/risemap-capture/deep/production/subcontract-reconciliation/rm087/984-rm087-pool-supplier.dom.txt`、`985-rm087-pool-order.dom.txt`、`986-rm087-pool-receive-batch.dom.txt`、`987-rm087-statement-tab.dom.txt`、`988-rm087-statement-status.dom.txt`
- RM-093 结果页：`docs/references/risemap-capture/deep/production/subcontract-reconciliation-report/rm093/1002-rm093-summary.dom.txt`、`1003-rm093-lines.dom.txt`、`1004-rm093-fee-type.dom.txt`、`1005-rm093-status-filter.dom.txt`、`1006-rm093-empty-export.dom.txt`
- 委外回厂、入库和 NCR 的补充证据见 `docs/references/risemap-capture/deep/production/` 对应目录及 `docs/risemap-rolling-handoff.md`。

Forge：

- 菜单与页面入口：`apps/forge-objectstack/objectstack.config.ts`
- 订单上下文：`apps/forge-objectstack/src/pages/subcontract-workspace.page.ts`
- 委外对账池：`apps/forge-objectstack/src/pages/subcontract-reconciliation.page.ts`
- 结果报表：`apps/forge-objectstack/src/pages/subcontract-reconciliation-report.page.ts`
- 委外库存工作台：`apps/forge-objectstack/src/pages/subcontract-stock.page.ts`
- 状态动作：`apps/forge-objectstack/src/actions/subcontract-reconciliation.action.ts`、`subcontract-ncr.action.ts`、`subcontract.action.ts`
- 浏览器和重启证据：`docs/forge-subcontract-acceptance-review-20260912.md`、`docs/forge-subcontract-reconciliation-slice.md`及 `apps/forge-objectstack/tests/subcontract-*.mjs`

## 对照结论

1. 页面信息架构已经按 RISEMAP 的生产/委外入口拆分，委外库存、待办池和结果报表没有再直接暴露为单一技术对象页面。
2. Forge 已证明一条同库 API 连续链，以及多个真实页面阶段从订单上下文办理签收、入库、NCR、退料、对账和应付；尚未证明一次全程浏览器连续办理。
3. 目前只能把字段结构、入口关系和已实际办理的 Forge 行为列为已证明；不能把 RISEMAP 只读页面推断出的供应商确认、部分结算、差异关闭和付款关系写成已复刻。
4. 视觉差异属于 ObjectStack Console 承载差异，不作为当前功能阻断；错误状态、来源丢失、异常绕过和无法进入下一岗位仍是阻断。

## 2026-09-12 回厂入库上下文修补

RISEMAP 的委外回厂证据（DR-0472）将回厂验收、不良处理和正式入库作为相互关联但不同的业务节点。Forge 原有回厂页支持待入库确认，但订单上下文使用 `order_id` 进入时会重新打开回厂新建流程，导致仓库无法直接办理当前待入库记录。

本次修补在回厂页的订单上下文初始化阶段优先查找当前订单的 `pending_inbound` 记录并打开确认对话框；没有待入库记录时才进入登记回厂逻辑。浏览器已验证从订单上下文打开、确认入库、KPI 和列表状态变化；API 与同一 SQLite 重启回读证明正式入库完成，同时同一来源 NCR 仍保持待处理状态。

该记录证明 Forge 本地“回厂 → 良品入库”入口连续性，不证明 RISEMAP 写入行为、拒收/复检路径、混合批次策略或角色权限已经等价。

## 2026-09-12 质量任务上下文修补

RISEMAP 的委外指南将回厂不良、异常处理和赔偿/结算作为来源可追溯的后续任务。Forge 订单上下文原先只传 `order_id` 进入 NCR 页，页面仍展示全部 NCR，质量人员需要重新判断当前单据。

本次修补让 NCR 页按订单上下文过滤记录。浏览器已验证从 `SC-ORDER-001` 进入后只显示 `NCR-SR-API-20260912-001-01`，并保留“待提交 → 设置方案”的下一步。该证据只证明 Forge 本地任务聚焦，不证明 RISEMAP 的异常处理写入、赔偿扣款关系或角色权限等价。

## 2026-09-12 订单签收上下文修补

RISEMAP 证据 `docs/risemap/verticals/production/subcontracting.md` 的 DR-0481 记录了发料实际出库后的交接签收语义，签收不自动开始加工。Forge 原有 Action 已具备该状态转换，但订单上下文在 `issued` 状态下没有明确下一步，且仅携带 `order_id` 会打开新建发料页。

本次独立分支修补将 `issued` 派生为“待供应商签收”，结果列显示“等待供应商签收”，并携带具体 `issue_id` 跳转到签收办理页。内置浏览器已用 `SC-ORDER-001 / SI-SIGNOFF-CONTEXT-001` 完成打开对话框、提交签收和反馈回读；API 与同一 SQLite 重启回读保持 `signed`，订单仍为 `in_progress`，未重复移动库存或自动开始加工。

该记录证明的是 Forge 本地页面连续性和既有 Action 的可办理性，不证明 RISEMAP 已成功写入，也不证明外部供应商身份、多账号权限或并发事务语义。下一步仍应先复核 RISEMAP 的真实签收入口与角色边界，再决定是否改造权限和待办分派。

因此，本样板可以进入“委外剩余行为的证据复核”，但不能作为采购、生产、销售或财务其他模块的自动迁移模板。

## 2026-09-12 对账岗位上下文修补

RISEMAP 的委外结算入口应从当前单据继续办理来源批次、阻断原因和结算结果。Forge 原有对账页不读取订单上下文，订单页的“进入委外对账”会展示全量待对账批次和对账单，存在跨订单误选风险。

本次修补让对账页读取 `order_id`，并将待对账、暂不可对账和已有对账单限制在当前订单；财务从独立菜单进入时仍保留全量对账池。该变更只收窄页面上下文，不改变金额计算、可对账条件或状态动作。

本记录证明 Forge 本地上下文筛选的实现边界；多订单真实材料下已完成无上下文全量对账单与 `SC-ORDER-001` 订单上下文的内置浏览器并排验证，后者只显示该订单的 `REC-MULTI-ORDER-004` 和对应来源批次，且同一 SQLite 重启后两张不同订单对账单及来源行保持正确关联。RISEMAP 线上结算写入、供应商确认和差异/赔偿语义仍待复核。

## 2026-09-12 退料岗位上下文修补

RISEMAP 的委外退料入口需要在当前订单和供应商侧在外余量的上下文中办理，退料确认与仓库入库是两个连续岗位节点。Forge 订单页原先只携带 `order_id`，退料页不读取它，仓库无法直接定位当前订单的待入库退料单。

本次修补让退料页按 `order_id` 过滤当前订单的退料记录和可退订单范围，并在当前订单存在待入库退料单时直接打开仓库入库确认对话框；独立菜单进入时仍保持全量列表。该变更只修复任务上下文，不改变退料数量校验、库存回写或状态动作。

本记录证明 Forge 本地退料岗位入口连续性的实现边界；在多订单材料下，全量页面同时显示 `SC-ORDER-001` 的待入库退料和 `SC-ORDER-003` 的草稿，`SC-ORDER-001` 上下文只显示当前退料单并自动打开仓库入库对话框；停服重启后当前退料/待入库单仍为 `pending_inbound / pending`，另一订单仍为 `draft`。RISEMAP 线上写入、供应商确认和赔偿语义仍待复核。

## 2026-09-12 质量处置完整浏览器链

在独立端口 `4458` 的内置浏览器中，进入委外订单上下文并对 `NCR-SR-NCR-BROWSER-001-01` 完成“设置返工方案、提交审批、审核通过、执行处置”。页面可见状态从待提交连续变为已执行，执行结果回写来源回厂单，NCR 不进入正式库存。停服后使用同一 SQLite 重启，API 回读确认方案说明、执行说明、5 条操作日志、NCR `executed`、返工数量 1 和来源回厂单 `ncr_resolved`。

该记录证明 Forge 本地页面与既有 Action 的连续性、阻断和持久化，不证明 RISEMAP 已成功写入，也不证明 RISEMAP 对退货、特采、报废、返工四类处置的字段、审批角色、赔偿扣款和执行后订单语义已经等价。验收脚本此前错误地在 `execution_result` 中寻找配置阶段说明，现已改为分别核对业务字段和对应日志；这属于验收材料修正，不是新增产品能力。

## 2026-09-12 对账确认与应付生成浏览器链

在无上下文委外对账页面中，真实浏览器对 `REC-MULTI-ORDER-004` 完成确认锁定和生成应付，页面显示来源 `SR-MULTI-ORDER-004 / SC-ORDER-001`、应付 `AP-REC-MULTI-ORDER-004` 和 `¥71.00`；同页另一订单 `REC-MULTI-ORDER-004B` 仍为待确认。停服后同一 SQLite 回读为当前对账单 `payable_generated`、应付金额 `71`、来源行 1 条，另一张仍为 `pending_confirmation`。

该记录证明 Forge 本地财务岗位动作和单据隔离，不证明 RISEMAP 的供应商确认、付款、发票、差异关闭或赔偿扣款行为已经等价。
