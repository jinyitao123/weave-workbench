# Forge 页面同类缺陷清单（2026-09-16）

本清单由当前源码扫描得出，只记录事实与待办，不构成验收结论。扫描命令基于 `apps/forge-objectstack/src/pages/*.ts`。

## 一、页面自绘面包屑（与 Console 外壳和共享标题区重复）

判定条件：同一文件内出现 `fp-list-context` 且其内嵌 `fp-phase`。

已整改：`purchase-request.page.ts`、`purchase-todo-pool.page.ts`（本轮）。

待处理（26 个文件）：

- 供应链：`bom-workspace.page.ts`、`other-inbound-workspace.page.ts`、`pending-outbound-shipments.page.ts`
- 生产：`production-config.page.ts`、`production-data-task.page.ts`、`production-inventory-workspace.page.ts`、`production-outbound-list.page.ts`
- 销售：`sales-additional-fee.page.ts`、`sales-collection-flow.page.ts`、`sales-contract-workspace.page.ts`、`sales-crm-service-pages.page.ts`、`sales-direct-outbounds.page.ts`、`sales-invoice-request.page.ts`、`sales-management-pages.page.ts`、`sales-order-workspace.page.ts`、`sales-outbound-list.page.ts`、`sales-return-workspace.page.ts`、`sales-shipment-workspace.page.ts`
- 采购退换与出库：`purchase-return-outbounds.page.ts`、`outbound-lines-list.page.ts`
- 项目：`project-plan-workspace.page.ts`
- 配置类：`business-prerequisite-config.page.ts`
- 库存：`inventory-damage.page.ts`、`inventory-operations.page.ts`
- 其他：`other-outbound-workspace.page.ts`

处理要求：逐页确认该页是否已有 `ForgePageHeader` 或独立 `h1`。已使用共享标题区的，直接删除自绘面包屑；仍使用旧 `fp-page-header` 的，先改用共享 `ForgePageHeader` 再把原有动作搬进标题工具栏，避免删掉入口。每页改动都需要桌面与窄屏页面检查。

## 二、宽表缺少固定状态 / 操作列

判定条件：表格声明 `min-width` ≥ 1200px，但文件中没有 `position:sticky;right` 规则。共 28 个文件，例如 `inventory-overview.page.ts`、`inventory-count.page.ts`、`inventory-transfer.page.ts`、`material-search.page.ts`、`material-combinations.page.ts`、`purchase-order-workspace.page.ts`、`purchase-invoice.page.ts`、`sales-outbound-list.page.ts`、`subcontract-inbound-report.page.ts`、`counterparty-reconciliation.page.ts` 等。

处理要求：把首列（业务编号）固定在左、末列（状态或操作）固定在右，并给固定列加分隔阴影；金额、数量列右对齐并使用等宽数字。可参考 `production-inventory-workspace.page.ts` 的既有实现与本轮 `purchase-request.page.ts` 的做法。

## 三、日期范围缺少起止说明

判定条件：同一筛选区出现两个 `ForgeDateInput`，但没有可见的范围标题或 `~` 分隔。

当前共 74 个文件使用 `ForgeDateInput`，需在各自批次内逐页核对；本轮已整改 `purchase-request.page.ts`（“申请日期” + 起 / 止），财务开票任务由对应任务整改。

处理要求：影响整页统计的期间选择放在指标之前，仅影响列表的日期条件留在列表筛选区内；两个日期必须说明起止含义，清空筛选要同时重置起止。

## 四、使用边界

- 以上属 Forge 页面质量与结构整改项，不改变 RISEMAP 业务事实、字段含义、状态或阻断规则。
- 任一页整改后仍需按项目要求完成 RISEMAP 与 Forge 双侧实时对照、控件实操、桌面与窄屏检查，才可从 `review_required` 转为 `accepted`。
