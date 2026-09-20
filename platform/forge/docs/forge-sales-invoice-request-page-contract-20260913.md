# 销售发票页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“销售发票”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 页面入口

- RISEMAP 销售发票：`https://risemap.cn/sales/invoices`
- Forge 销售发票：`http://localhost:4321/_console/apps/forge/page/page_sales_invoice_request`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 销售发票”，标题为“销售发票”，页面说明为“开票申请的发起记录与流转状态跟踪；正式发票由财务在「发票管理」登记回写”。该页面是销售侧开票申请跟踪视角，不是正式销项发票台账。

状态页签包含：全部、待审批、已审批、已开票、已驳回、已撤回。首屏动作包含“导出”“导出任务”“刷新”和图标操作按钮。筛选区有搜索框。表头列为：申请号、客户 / 销售方、模式、合并订单、价税合计、状态、申请时间、申请人、关联发票、操作。当前账号下列表为空，空态文案为“暂无开票申请记录，可在销售订单发起开票”。页脚显示“共 0 笔申请 · 价税合计 ¥ 0.00”。

本轮没有在 RISEMAP 发起开票申请或登记正式发票，因此开票申请提交、审批和财务回写仍属于待同材料复核路径。

## Forge 改造前差异

Forge 销售菜单中的“销售发票”此前指向销售占位页，不能按 RISEMAP 当前页展示开票申请状态页签、申请列表、关联发票回写和销售订单发起入口。

## Forge 本轮实现

- 新增业务工作区 `page_sales_invoice_request`，并把销售业务下的“销售发票”入口指向该页面。
- 页面按 RISEMAP 当前页展示销售开票申请跟踪视角，包含六个状态页签、搜索、导出禁用态、申请表头、空态和页脚汇总。
- 由于 Forge 当前已有正式销项发票对象 `forge_sales_invoice`，页面在有正式发票时作为“关联发票”回写展示，并提供进入收入确认和正式发票登记的业务入口。
- 没有把正式销项发票对象直接描述为 RISEMAP 已观察的开票申请对象；二者在合同中分层记录。

## 分层说明

RISEMAP 当前销售发票页没有可办理数据，本轮只能完成入口、说明、页签、表头、空态和页脚汇总对照。Forge 的正式发票登记、应收账款和收入确认是已有财务承接能力，不能替代 RISEMAP 的开票申请审批流取证。

## 浏览器证据

- RISEMAP 销售发票：`risemap-sales-invoices.ax.txt`、`risemap-sales-invoices.png`。
- Forge 销售发票：`forge-sales-invoice-request.ax.txt`、`forge-sales-invoice-request.png`。

## 当前结论

“销售发票”已经从销售占位入口推进为可对照的销售开票申请跟踪页。当前可验收范围是 RISEMAP 当前空态页面结构；开票申请发起、审批、撤回、正式发票回写和后续收入确认需要后续同材料办理复核。
