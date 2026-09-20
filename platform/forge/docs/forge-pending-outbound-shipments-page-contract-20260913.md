# 待出库发货单页面合同（RISEMAP 结构验收）

记录日期：2026-09-13  
本轮范围：销售发货单下一步入口“待出库发货单”。  
对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。  
最终验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 本轮实际打开的页面

- RISEMAP 销售发货单：`https://risemap.cn/sales/outbound`
- RISEMAP 待出库发货单：`https://risemap.cn/inventory/outbound/shipments`
- Forge 改造前入口目录：`http://localhost:4321/_console/apps/forge/page/page_supply_chain_gap`
- Forge 待出库发货单：`http://localhost:4321/_console/apps/forge/page/page_pending_outbound_shipments`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

销售发货单页面的“下一步操作 待出库发货单”真实跳转到 `https://risemap.cn/inventory/outbound/shipments`。该页面属于“出库管理”，页面标题为“待出库发货单”，页面说明为“管理所有出库单和待出库发货单”。首屏动作包含“下一步操作 出库单列表”和“刷新”。

当前账号下列表有 1 条记录：`DN-2026-0001`，关联来源显示 `SC-OEM-20260909-001`，客户单号 `—`，客户“苏州澄岳自动化装备有限公司”，收货人“周启明”，收货地址“苏州市工业园区澄岳路9号”，含税金额 `¥128,000.00`，出库进度 `0 / 1 台`，并提示“尚未被任何出库单占用 / 待建 1 台”，状态“待发货”，日期 `2026-09-09`，操作包含“查看详情”和“去发货”。表头列为：发货单号、客户单号、客户、收货人、收货地址、含税金额、出库进度、状态、日期、操作。分页默认每页 20 条。

## Forge 改造前表现

Forge 的供应链“待出库发货单”入口此前指向 `page_supply_chain_gap`，只能在“供应链业务入口”目录中看到入口名称，没有待出库列表、来源发货单、出库进度、业务操作和出库承接弹窗。

## Forge 本轮落地

- 新增业务工作区 `page_pending_outbound_shipments`，并把供应链出库管理下的“待出库发货单”入口指向该页面。
- 销售发货单工作区的“下一步操作 待出库发货单”改为指向该专门页面。
- 页面只展示状态为待发货或部分出库的销售发货单，已全部出库的发货单不再进入待出库队列。
- 列表对齐 RISEMAP 当前表头，并增加本地负责人列，用于和 Forge 任务归属一致显示。
- “创建出库单”使用 ObjectStack Console 共享弹窗，第一步填写出库单号、仓库、日期、数量、客户自取和备注，第二步显示发货单、仓库、数量与库存扣减影响。
- 出库提交复用已验证动作 `sales_shipment_create_outbound`，由动作读取真实库存余额并阻止库存不足、数量超额和状态变化。

## 明确差异与处理结论

- RISEMAP 当前待出库页已出现 `DN-2026-0001`，但本轮没有在 RISEMAP 点击“去发货”提交出库；Forge 使用本地验收库中的 `DN-PENDING-UI-20260913-001` 展示并打开“创建出库单”弹窗。
- RISEMAP 当前待出库页未观察到实际提交出库成功；Forge 的库存校验和出库扣减属于已实现执行扩展，已通过 API、库存和重启回读证明，但仍不能冒充 RISEMAP 成功出库事实。
- RISEMAP 表头没有显示负责人；Forge 显示 `Dev Admin` 作为本地办理人，属于 Forge 承接责任显示，不记为 RISEMAP 功能缺口。
- Forge 当前“下一步操作 出库单列表”已指向业务工作区 `page_sales_outbound_list`，用于承接 RISEMAP 的出库管理下一步入口。

## 验收记录

### 内置浏览器

- RISEMAP 销售发货单点击下一步，并进入待出库发货单：`risemap-pending-outbound-shipments.ax.txt`、`risemap-pending-outbound-shipments.png`。
- Forge 改造前供应链入口目录：`forge-pending-outbound-before.ax.txt`、`forge-pending-outbound-before.png`。
- Forge 待出库发货单业务工作区：`forge-pending-outbound-workspace.ax.txt`、`forge-pending-outbound-workspace.png`。
- Forge 待出库发货单停服重启后回读页面：`forge-pending-outbound-workspace-restart.ax.txt`、`forge-pending-outbound-workspace-restart.png`、`forge-pending-outbound-workspace-restart-current.ax.txt`、`forge-pending-outbound-workspace-restart-current.png`。
- Forge 创建出库单弹窗第一步：`forge-pending-outbound-dialog-step1.ax.txt`、`forge-pending-outbound-dialog-step1.png`。
- Forge 创建出库单二次确认：`forge-pending-outbound-dialog-step2.ax.txt`、`forge-pending-outbound-dialog-step2.png`。

浏览器验收材料：`DN-PENDING-UI-20260913-001`，关联订单 `SO-WF-20260909-001`，客户“苏州澄岳自动化装备有限公司”，收货人“周启明”，收货地址“苏州市工业园区澄岳路9号”，含税金额 `¥128,000.00`，出库进度 `0 / 1 台`，状态“待发货”，负责人 `Dev Admin`。二次确认前已取消，没有提交该条页面验收出库。

### API、库存与持久化

复用销售发货与销售出库链路验收。最终干净库按顺序通过：

- `scripts/seed-reference-data.mjs`
- `acceptance:sales`
- `acceptance:sales-workflow`
- `acceptance:sales-conversion`
- `acceptance:sales-shipment`
- `acceptance:inventory`
- `acceptance:sales-outbound`

页面实现后，完整停服并从同一 SQLite 文件重启，通过：

- `acceptance:sales-restart`

工程门禁通过项记录在销售业务阶段总验收中。

## 当前状态

“待出库发货单”已经从供应链入口目录页推进为可对照的业务工作区，并完成了 RISEMAP 实时入口取证、Forge 列表和弹窗浏览器走查、二次确认、库存动作复用和同库重启回读。当前可验收范围是销售发货单到出库执行的承接队列。出库单列表专页已经补齐为下一步承接页面；物流登记、条码打印、导出和收入确认办理动作继续作为销售交付链后续缺口。
