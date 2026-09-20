# 出库单列表页面合同（RISEMAP 结构验收）

记录日期：2026-09-13  
本轮范围：销售发货单下游的出库单列表入口。  
对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。  
最终验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 本轮实际打开的页面

- RISEMAP 待出库发货单：`https://risemap.cn/inventory/outbound/shipments`
- RISEMAP 出库单列表：`https://risemap.cn/inventory/outbound`
- Forge 改造前对象表：`http://localhost:4321/_console/apps/forge/forge_sales_outbound`
- Forge 出库单列表：`http://localhost:4321/_console/apps/forge/page/page_sales_outbound_list`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

待出库发货单页面的“下一步操作 出库单列表”真实跳转到 `https://risemap.cn/inventory/outbound`。该页面属于“出库管理”，标题为“出库单列表”，页面说明为“管理所有出库单和待出库发货单”。首屏动作包含“打印条码”“导出”“刷新”和图标操作按钮；未选择出库单时“打印条码”禁用。

筛选区包含搜索、业务类型和状态。当前账号下列表为空，共 `0` 条记录。表头列为：出库单号、关联单号、销售单号、客户单号、往来单位、物料明细、仓库、出库日期、状态、物流信息、收入确认、操作员、操作。分页默认每页 20 条。

## Forge 改造前表现

Forge 的“出库单列表”此前直接指向通用对象表 `forge_sales_outbound`，能查看底层出库对象，但没有按 RISEMAP 当前页组织表头、筛选、打印条码禁用态、物流信息、收入确认和销售发货上下文。

## Forge 本轮落地

- 新增业务工作区 `page_sales_outbound_list`，并把供应链出库管理下的“出库单列表”入口指向该页面。
- 待出库发货单页面的“下一步操作 出库单列表”改为指向该专门页面。
- 页面展示出库单号、关联发货单、销售订单、客户单号、往来单位、物料明细、仓库、出库日期、状态、物流信息、收入确认、操作员和查看操作。
- 列表读取销售出库单的库存快照，展示出库前后库存数量，便于核对库存扣减结果。
- “打印条码”“导出”保留为禁用按钮，表示 RISEMAP 当前首屏存在该入口，但 Forge 本轮未实现打印和导出能力。

## 明确差异与处理结论

- RISEMAP 当前出库单列表没有数据行，本轮只能对照入口、标题、动作、筛选和表头。Forge 使用本地验收链生成的 `OUT-CONVERT-20260909-001` 展示已出库记录、来源发货单和库存快照。
- RISEMAP 的物流信息和收入确认字段当前无行可验证。Forge 列表中“客户自取 / 待登记物流”和收入确认状态来自现有本地出库对象，作为执行扩展展示，不写成 RISEMAP 已观察规则。
- RISEMAP 当前页有导出和打印条码入口。Forge 本轮保留禁用态，不把未实现的批量打印或导出描述成已完成。

## 验收记录

### 内置浏览器

- RISEMAP 出库单列表：`risemap-outbound-list.ax.txt`、`risemap-outbound-list.png`。
- Forge 改造前出库对象表：`forge-outbound-list-before.ax.txt`、`forge-outbound-list-before.png`。
- Forge 出库单列表业务工作区：`forge-outbound-list-workspace.ax.txt`、`forge-outbound-list-workspace.png`。
- Forge 出库单列表停服重启后回读页面：`forge-outbound-list-workspace-restart.ax.txt`、`forge-outbound-list-workspace-restart.png`。

最终 Forge 页面显示 `OUT-CONVERT-20260909-001`、关联发货单 `DN-CONVERT-20260909-001`、销售订单 `SO-CONVERT-20260909-001`、往来单位“苏州澄岳自动化装备有限公司”、出库数量 1 台、仓库、出库日期 `2026-09-09`、状态“已出库”、收入确认“待确认”、操作员 `Dev Admin`。

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

“出库单列表”已经从通用对象表推进为可对照的业务工作区，完成了 RISEMAP 实时入口取证、Forge 首屏列表、来源关系、库存快照、收入确认状态展示和工程门禁。当前可验收范围是销售出库单归档和库存扣减结果回看。物流登记、条码打印、导出和收入确认办理动作仍是后续缺口。
