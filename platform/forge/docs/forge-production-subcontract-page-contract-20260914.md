# 生产域委外管理页面合同与验收记录

对照日期：2026-09-14  
对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户比较。  
验收数据库：`apps/forge-objectstack/.objectstack/data/objectstack.db`  

## 本轮实时打开的页面

| 业务环节 | RISEMAP 当前页面 | Forge 当前页面 |
| --- | --- | --- |
| 委外订单 | `https://risemap.cn/subcontract/orders`、`/subcontract/orders/new` | `page_subcontract_workspace` |
| 委外发料 | `https://risemap.cn/subcontract/issues`、`/subcontract/issues/new` | `page_subcontract_issue_workspace` |
| 委外回厂 | `https://risemap.cn/subcontract/receives` | `page_subcontract_receipt_workspace` |
| 委外退料 | `https://risemap.cn/subcontract/returns` | `page_subcontract_return_workspace` |
| 委外厂库存 | `https://risemap.cn/inventory/subcontract-stock` | `page_subcontract_stock` |
| 委外对账 | `https://risemap.cn/subcontract/reconciliation` | `page_subcontract_reconciliation` |
| 委外供应商 | `https://risemap.cn/subcontract/suppliers` | `page_subcontract_suppliers` |
| 入库报表 | `https://risemap.cn/subcontract/reports/receipts` | `page_subcontract_inbound_report` |
| 对账汇总表 | `https://risemap.cn/subcontract/reports/reconciliation-statement` | `page_subcontract_reconciliation_report` |
| 委外追溯 | `https://risemap.cn/subcontract/traces` | `page_subcontract_trace` |
| 未交付报表 | `https://risemap.cn/subcontract/reports/undelivered` | `page_subcontract_undelivered` |
| 委外看板 | `https://risemap.cn/subcontract` | `page_subcontract_dashboard` |
| 上手指南 | `https://risemap.cn/subcontract/guide` | `page_subcontract_guide` |

## RISEMAP 当前事实

- 委外订单列表包含指标、创建、导入导出、筛选、列表和分页；新建页包含供应商、供料方式、交期、项目、来源、检验方式、付款条件、备注、加工件和发料计划。
- 委外发料支持正常发料与超耗发料，表单从委外订单承接供应商、经手人和发料明细。
- 委外回厂当前页面有指标、筛选、导出、列表和分页，本轮账号页面未出现独立新建按钮。
- 委外退料有新建、导出、状态、供应商和退料原因筛选。
- 委外厂库存按供应商和物料查看，呈现账龄区间、余额与金额，并提供“去发料”。
- 委外对账包含待对账池和对账单，待对账池可按供应商、订单和回厂批次查看。
- 委外供应商围绕加工能力和启用状态维护可选供应商。
- 入库报表包含五项指标、供应商/日期/不良筛选和 18 列明细；对账汇总表包含汇总与明细两个页签、五项指标和供应商/账期筛选。
- 委外追溯支持按物料批次正向追成品、按成品批次反向查来源，得到结果后才允许导出。
- 未交付报表包含五项指标、逾期/供应商/工序筛选、12 列明细和每页 20 条分页。
- 委外看板包含业务概览、五项待办指标、我的待办、在途订单、快捷入口和近期订单。
- 上手指南按业务经办、仓库、质检/收货、财务四类岗位组织六个业务阶段，并从文章步骤直接进入对应办理页面。
- 上述列表在当前 RISEMAP 账号下均缺少可办理数据，因此写入动作、阻断与提交后状态仍属于“待 RISEMAP 同材料复核”。

## Forge 页面职责与本轮处理

| 页面 | 岗位任务 | 本轮处理与结果 |
| --- | --- | --- |
| 委外订单 | 建立订单、加工件和发料计划，提交审核并进入执行链 | 列表改为真实 20 条分页；移除没有实际展开行为的“BOM 展开”控件；发料计划改为直接填写计划发料与标准应耗 |
| 委外发料 | 按订单分批发料、审核、出库和供应商签收 | 列表改为真实 20 条分页，筛选和指标会回到第一页；日期统一为业务日期；页脚只汇总当前页 |
| 委外回厂 | 登记回厂、验收，生成并确认待入库 | 页面名称统一为“委外回厂”；缺失状态显示“验收处理中”；零数量良率显示为 `—` |
| 委外退料 | 登记供应商退料，确认交接并由仓库确认入库 | 增加可用的刷新操作；保留退料确认和入库确认两个岗位节点 |
| 委外厂库存 | 查看供应商在外材料余额、耗用、退回和账龄 | 按业务供应商名称合并历史重复档案，筛选项和汇总不再重复显示同一家供应商 |
| 委外对账 | 选择可结算回厂来源，生成、确认对账单并生成应付 | 去除供应商分组的重复名称；生成对账单使用标准日期控件和二次确认，弹窗显示供应商、账期、来源数量及占用影响 |
| 委外供应商 | 维护委外供应商及加工能力 | 保留加工能力筛选、启用状态与供应商列表，供应商名称按业务口径呈现 |
| 入库报表 | 核对回厂验收、入库数量、金额和良率 | 保留五项指标、业务筛选、18 列明细与来源关系 |
| 对账汇总表 | 按供应商和账期复核对账与应付 | 指标和筛选按供应商名称合并历史重复档案，修正同一家供应商被统计为两家的问题 |
| 委外追溯 | 正向或反向追溯委外批次 | 正向和反向选择会切换输入提示；未得到追溯结果前不提供导出动作 |
| 未交付报表 | 跟踪订单待交数量和逾期风险 | 增加真实每页 20 条分页；供应商筛选按名称合并重复档案；逾期指标只统计有效未交付明细 |
| 委外看板 | 集中判断当前工作并进入下一业务动作 | 重建业务概览、五项指标、岗位待办、在途订单、快捷入口和近期订单，清除开发验证类文案 |
| 上手指南 | 按岗位学习并进入完整委外办理链 | 替换原工程数据汇总页；提供岗位、阶段、事项搜索、前置条件、办理步骤、完成标准、阻断检查和真实业务入口；学习状态在本机保留 |

## 正常路径、阻断与持久化

- API 连续链已完成：订单 → 审核 → 发料 → 出库 → 供应商签收 → 回厂验收 → 良品入库 → 不良处置 → 对账 → 应付。
- 页面已验证委外订单分页、发料分页、回厂状态与良率、库存供应商合并，以及对账单生成前的标准二次确认。
- 对账来源在生成后不能重复用于另一张有效对账单；未入库或不良未处置的回厂来源保持阻断并显示下一步。
- 服务完整停止后以同一 SQLite 重启，按原单据 ID 回读订单、回厂、入库、不良、对账、应付、库存倒冲和流水，验收通过。

## 判定

Forge 委外核心业务链已达到本地可办理与可恢复门禁，页面名称、分页、重复供应商和无效控件问题已修正。RISEMAP 当前页面结构与 Forge 页面职责已经逐项记录；由于 RISEMAP 当前缺少可办理数据，不能把 Forge 的写入结果描述为 RISEMAP 同材料对照通过。后续若 RISEMAP 出现可办理订单，应优先补做相同材料的发料、回厂、退料和对账写入对照。

本轮使用 `objectstack-ui`、`objectstack-query` 和 `objectstack-data` 约束页面、查询与业务数据关系。工程门禁执行 `pnpm typecheck`、`pnpm validate`、`pnpm build`；委外连续链及同一 SQLite 重启回读均通过。
