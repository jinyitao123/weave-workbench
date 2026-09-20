# Forge 生产域页面合同与清障清单

更新时间：2026-09-15

## 证据边界

- RISEMAP 当前事实来自 2026-09-15 已登录内置浏览器的生产导航与对应页面；当前账号下列表均为空，因此只能确认入口、首屏、字段、状态筛选、动作和空态，不能确认有数据时的提交结果。
- Forge 当前表现来自独立分支 `codex/production-pages`、端口 `4412` 和 `.objectstack/production-pages.sqlite` 的内置浏览器检查。
- `review_required` 表示页面入口与当前首屏已核对，但尚未同时具备同一组可办理材料、正常路径、关键阻断、桌面与窄屏、API 结果及停服重启回读证据。不得解释为已验收。
- `Forge decision`：生产准备检查与加工价目是 Forge 为连续办理增加的入口；RISEMAP 当前生产导航没有这两个入口，不能写成 RISEMAP 复刻事实。

## 页面合同

| 分组 | 页面与入口 | 主原型 | RISEMAP 当前事实 | Forge 当前职责与本轮结论 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 组装 | 生产准备检查 / `page_production_prerequisites` | configuration | RISEMAP 无对应独立入口 | Forge decision；集中检查仓库、物料、BOM、原因字典、图纸与委外前置，每个缺口给出真实下一步入口 | review_required |
| 组装 | 组装单 / `/production/assembly` / `page_production_assembly_workspace` | task_workspace | KPI、八类状态、搜索、导入导出；列为单号、成品、BOM、数量、合格/不合格、物料与成本、来源、日期、创建人 | 列表、草稿、下达、齐套、领退补料、分批入库、完工；本轮修复 Console 登录态读取 | review_required |
| 组装 | 缺料待办 / `/production/shortages` / `page_production_shortage_workspace` | analysis | 按计划完工日期分配库存，汇总缺料单据、物料、缺口与最早日期 | 同口径只读分析；本轮接入共享产品页根节点并清除重复 Console 标题 | review_required |
| 组装 | 领料单 / `/production/requisitions` / `page_production_material_workspace` | task_workspace | 五类状态、类型筛选、单号/类型/成品/来源/物料/数量/金额/经手/日期 | 必须从待领料组装单进入；确认后过账并关联库存流水；本轮修复会话读取 | review_required |
| 组装 | 补料单 / `/production/material-supplies` / `page_production_supply_workspace` | task_workspace | 五类状态；补料物料、金额和来源单指标 | 必须从组装中单据进入，按明细补领；本轮修复会话读取 | review_required |
| 组装 | 退料单 / `/production/material-returns` / `page_production_return_workspace` | task_workspace | 五类状态；列表额外显示仓库 | 仅允许有净领用数量的组装中单据退料；本轮修复会话读取 | review_required |
| 组装 | 拆解单 / `/production/disassembly` / `page_production_disassembly_workspace` | task_workspace | 八类状态；成品、BOM、数量、原因、回收和报废 | 扣减成品，逐项回收入库或报废；原因字典为空时明确阻断；本轮修复会话读取并启用共享页面根样式 | review_required |
| 组装 | 换件单 / `/production/rework` / `page_production_replacement_workspace` | task_workspace | 八类状态；产品不离库，更换内部组件 | 保持整机库存不变，办理新件领用与旧件回收/报废；本轮修复会话读取并启用共享页面根样式 | review_required |
| 图纸 | 上手指南 / `page_drawing_guide` | configuration | 当前导航存在指南入口 | 说明建档、版本、评审、发布、变更、发放与关联顺序，动作进入真实页面 | review_required |
| 图纸 | 图纸总览 / `page_drawing_workspace` | workbench | 当前导航存在总览入口 | 汇总状态、待办与版本风险；本轮数据读取改用 Console 适配器 | review_required |
| 图纸 | 图号档案 / `page_drawing_archive` | task_workspace | 当前导航存在档案入口 | 图号、版本文件、访问范围与新建入口；本轮数据读取改用 Console 适配器 | review_required |
| 图纸 | 图纸评审 / `page_drawing_review` | task_workspace | 当前导航存在评审入口 | 草稿版本提交、专业/截止日期/参与人、通过或退回；本轮清除认证错误 | review_required |
| 图纸 | 图纸发布 / `page_drawing_release` | task_workspace | 当前导航存在发布入口 | 仅已评审版本可发布，含范围、重大变更与影响说明；本轮清除认证错误 | review_required |
| 图纸 | 图纸变更 / `page_drawing_change` | task_workspace | 当前导航存在变更入口 | 已发布版本发起变更，记录类型、等级、原因与影响范围；本轮清除认证错误 | review_required |
| 图纸 | 图纸发放记录 / `page_drawing_distribution` | task_workspace | 当前导航存在发放入口 | 发放对象、方式、确认和回执；本轮清除认证错误 | review_required |
| 图纸 | 图纸关联查询 / `page_drawing_query` | analysis | 当前导航存在关联查询入口 | 按图号、名称、版本和物料查询业务使用关系；本轮清除认证错误 | review_required |
| 图纸 | 客户图纸 / `/drawing/customer` / `page_customer_drawings` | task_workspace | 接收、评审、采纳、归档；筛选客户、保密等级、状态；列含客户图号、名称、客户、范围、版本、状态、接收日期 | 同职责，支持草稿和正式接收以及附件；本轮清除认证错误 | review_required |
| 委外 | 上手指南 / `page_subcontract_guide` | configuration | 当前导航存在指南入口 | 说明供应商、订单、发料、回厂、退料、对账与追溯顺序 | review_required |
| 委外 | 委外看板 / `page_subcontract_dashboard` | workbench | 当前导航存在看板入口 | 按供应商、订单、发料、回厂和结算汇总业务全景；本轮接入 Console 会话 | review_required |
| 委外 | 委外订单 / `/subcontract/orders` / `page_subcontract_workspace` | task_workspace | 四项指标；新建、导出、导入、任务；订单、供应商、关联、付款、加工费、发料/回厂/对账进度和交期 | 草稿、提交审核与执行上下文；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外发料 / `/subcontract/issues` / `page_subcontract_issue_workspace` | task_workspace | 全部、待审核、待发料、待签收；含供应商、订单、交接、经办人、物料和数量 | 甲供物料出库、锁定、委外库存与签收；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外回厂 / `/subcontract/receives` / `page_subcontract_receipt_workspace` | task_workspace | 回厂总数、待入库、已入库；含验收结果、入库单和质检员 | 回厂验收、材料倒冲与待入库生成；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外退料 / `/subcontract/returns` / `page_subcontract_return_workspace` | task_workspace | 有效、待入库、已入库；含原因筛选和退料结果 | 草稿确认只生成待入库单，仓库入库后扣减在外余量；本轮数据读取改用 Console 适配器并启用共享页面根样式 | review_required |
| 委外 | 委外对账 / `/subcontract/reconciliation` / `page_subcontract_reconciliation` | task_workspace | 待对账池与对账单；按供应商、订单、回厂批次查看可结算范围 | 加工费、补料、扣款与应付生成；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外供应商 / `/subcontract/suppliers` / `page_subcontract_suppliers` | configuration | 搜索、工艺能力、仅看已启用；绩效由已完成单据派生 | 维护工艺能力、信用和默认仓库，不允许手改派生绩效 | review_required |
| 委外 | 加工价目 / `page_subcontract_pricing` | configuration | RISEMAP 当前生产导航无此入口 | Forge decision；按供应商、加工类型和加工件维护有效价目；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外库存 / `/inventory/subcontract-stock` / `page_subcontract_stock` | analysis | 供应商/物料双视角、账龄、超期、在外数量与金额 | 同口径展示累计已发、耗用、退料和余额；本轮数据读取改用 Console 适配器并启用共享页面根样式 | review_required |
| 委外 | 批次追溯 / `/subcontract/traces` / `page_subcontract_trace` | analysis | 正向材料批次到成品、反向成品批次到材料 | 基于回厂倒冲记录双向追溯；本轮数据读取改用 Console 适配器并启用共享页面根样式 | review_required |
| 委外 | 委外未交 / `/subcontract/reports/undelivered` / `page_subcontract_undelivered` | analysis | 未交订单/行/数量/金额；超期、供应商、工艺筛选 | 按订单行计算未交与超期；本轮数据读取改用 Console 适配器并启用共享页面根样式 | review_required |
| 委外 | 委外进货 / `/subcontract/reports/receipts` / `page_subcontract_inbound_report` | analysis | 明细行、回厂单、总量、不良、良率、可结算加工费；日期与不良筛选 | 按物料行展示回厂、良品、不良与已入库可结算金额；本轮数据读取改用 Console 适配器 | review_required |
| 委外 | 委外对账单 / `/subcontract/reports/reconciliation-statement` / `page_subcontract_reconciliation_report` | analysis | 汇总/明细双视角；应付 = 加工费 + 补料 - 扣款；仅查询审计导出 | 同口径查询对账、费用构成和关联应付；本轮数据读取改用 Console 适配器 | review_required |

## 本轮停止规则与后续验收材料

- 当前 RISEMAP 所有上述业务列表均为 0 条，不能用 Forge 自建夹具宣称同材料对照通过。
- 页面出现认证错误、来源丢失、动作无反馈、状态绕过、异常仍可结算、重启结果不一致时，先修当前链，不继续扩新功能。
- 逐页改为 `accepted` 前，证据必须包含 RISEMAP 与 Forge 的操作前首屏、关键表单或弹窗、至少一个阻断、提交反馈、结果页、窄屏首屏、对应 API 断言，以及同一 SQLite 停服重启后的页面与数据回读。
