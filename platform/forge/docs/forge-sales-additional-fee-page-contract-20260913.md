# 附加费用页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“附加费用”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4322`。

## 页面入口

- RISEMAP 附加费用：`https://risemap.cn/sales/additional-fees`
- Forge 附加费用：`http://localhost:4322/_console/apps/forge/page/page_sales_additional_fee`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 附加费用”，标题为“附加费用”，页面说明为“销售附加费用创建、审批、财务执行与来源单关联管理”。首屏指标包含客户承担有效金额、公司承担有效金额、待审批费用单、待开票 / 待付款。筛选项包含搜索、来源类型、承担类型、单据状态、财务状态。动作包含“上手指南”“刷新”“导出”“导出任务”“新增附加费用单”。页面有“附加费用单”“附加明细”切换，以及“全部”“草稿”“待审批”“已生效”“已作废”状态页签。表头列为：费用单号、来源单据、客户 / 项目、承担类型、费用项、含税金额、单据状态、财务状态、负责人、操作。

当前账号下列表为空，空态文案为“当前条件下暂无附加费用单”。本轮未在 RISEMAP 新增附加费用或办理审批、开票、付款。

## Forge 改造前差异

Forge 销售菜单此前没有单独的“附加费用”入口，也没有销售附加费用对象，不能承载来源单据、承担类型、费用项、单据状态和财务状态。

## Forge 本轮实现

- 新增 `forge_sales_additional_fee` 业务对象，承载费用单号、来源类型、销售订单/合同/发货单来源、客户、项目、承担类型、费用项、发生日期、含税金额、单据状态、财务状态和负责人。
- 新增业务工作区 `page_sales_additional_fee`，并按 RISEMAP 顺序把“附加费用”加入销售业务菜单，放在销售订单之后、收款流水之前。
- 页面按 RISEMAP 当前结构展示四个指标、五个筛选项、附加费用单/附加明细切换、五个状态页签、表头、空态和分页。
- “新增附加费用单”使用 ObjectStack Console 弹窗；提交前有二次确认，明确保存草稿只进入待开票或待付款财务状态，不自动审批或生成收付款。
- 本地验收库通过页面创建 `AF-FORGE-20260913-001`，来源 `SO-WF-20260909-001`，客户“苏州澄岳自动化装备有限公司”，承担类型“客户承担”，费用项“运输附加费”，含税金额 `¥1,800.00`，单据状态“草稿”，财务状态“待处理”。

## 分层说明

RISEMAP 当前无附加费用数据，本轮完成的是页面结构和本地草稿创建回读。审批、生效、作废、开票和付款承接仍需 RISEMAP 同材料可办理路径复核。

## 浏览器证据

- RISEMAP 附加费用：`risemap-sales-additional-fees.ax.txt`、`risemap-sales-additional-fees.png`。
- Forge 附加费用空态：`forge-sales-additional-fee-empty.ax.txt`、`forge-sales-additional-fee-empty.png`。
- Forge 附加费用二次确认：`forge-sales-additional-fee-dialog-confirm.ax.txt`、`forge-sales-additional-fee-dialog-confirm.png`。
- Forge 附加费用列表回读：`forge-sales-additional-fee-workspace.ax.txt`、`forge-sales-additional-fee-workspace.png`。

## 当前结论

“附加费用”已经补齐为销售菜单入口、业务对象、页面列表和本地新增草稿闭环。当前可验收范围是 RISEMAP 当前首屏结构和 Forge 本地草稿回读；审批及财务执行仍为待复核实现。
