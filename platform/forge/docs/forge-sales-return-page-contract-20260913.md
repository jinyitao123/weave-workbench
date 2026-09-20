# 销售退货页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“销售退货”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4322`。

## 页面入口

- RISEMAP 销售退货：`https://risemap.cn/sales/returns`
- Forge 销售退货：`http://localhost:4322/_console/apps/forge/page/page_sales_return_workspace`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 销售退货”，标题为“销售退货”，页面说明为“客户退货申请审核、退款处理、责任原因归集”。首屏动作包含“新建退货”“导出”“导出任务”“刷新”和图标操作按钮。筛选项包含搜索框、“范围”“状态”“处理方式”。表头列为：退货单号、关联订单、客户、退货原因、处理方式、退货金额、状态、附件、操作。

当前账号下列表为空，空态文案为“暂无匹配的销售退货单”。本轮未在 RISEMAP 新建退货或办理后续审核、退款、责任归集。

## Forge 改造前差异

Forge 销售菜单中的“销售退货”此前指向销售占位页；工程内没有销售退货对象，不能保存退货申请，也不能按 RISEMAP 列表结构展示退货原因、处理方式、退货金额、附件和状态。

## Forge 本轮实现

- 新增 `forge_sales_return` 轻量业务对象，承载退货单号、关联订单、客户、申请日期、退货原因、处理方式、退货金额、附件说明、状态、申请人和负责人。
- 新增业务工作区 `page_sales_return_workspace`，并把销售业务下的“销售退货”入口指向该页面。
- 页面按 RISEMAP 当前页展示新建退货、导出/导出任务禁用态、范围/状态/处理方式筛选、表头、空态和分页。
- “新建退货”使用 ObjectStack Console 弹窗；提交前有二次确认，明确保存草稿不会自动改变销售订单、库存或资金状态。
- 本地验收库通过页面创建 `SR-FORGE-20260913-001`，关联 `SO-WF-20260909-001`，客户“苏州澄岳自动化装备有限公司”，处理方式“退货退款”，退货金额 `¥243,200.00`，状态“草稿”。

## 分层说明

RISEMAP 当前无退货数据，本轮完成的是列表结构和本地草稿创建闭环。退货申请提交、审批、退货入库、退款、责任原因归集和订单/库存/资金回写仍需 RISEMAP 同材料复核后再实现为动作链。

## 浏览器证据

- RISEMAP 销售退货：`risemap-sales-returns.ax.txt`、`risemap-sales-returns.png`。
- Forge 销售退货二次确认：`forge-sales-return-dialog-confirm.ax.txt`、`forge-sales-return-dialog-confirm.png`。
- Forge 销售退货列表回读：`forge-sales-return-workspace.ax.txt`、`forge-sales-return-workspace.png`。

## 当前结论

“销售退货”已经从占位入口推进为有对象、有业务列表、有新建草稿和二次确认的销售侧工作区。当前可验收范围是 RISEMAP 当前列表结构和 Forge 本地草稿保存回读；后续退货完整流转仍是待复核实现。

## 2026-09-20 实时复核与页面重构

- RISEMAP 实时入口仍为 `https://risemap.cn/sales/returns`。当前页面为橙色业务标题区；工具栏顺序为新建退货、导出、导出任务、刷新、列表设置；筛选为退货单号、范围、状态、处理方式；表头依次为退货单号、关联订单、客户、退货原因、处理方式、退货金额、状态、附件、操作。当前仍为零记录。
- Forge `page_sales_return_workspace` 已修复登录态读取，使用 Bearer 会话令牌加载数据，并按上述实时结构重排标题区、工具栏、筛选、表头和空态。范围筛选、行选择、CSV 导出和导出任务说明均为真实交互，不再使用静态文字冒充控件。
- 内置浏览器已实际打开导出任务说明；打开新建退货表单和标准日期选择器；在未填写关联订单、退货原因和处理方式时点击下一步，页面显示“请填写退货单号、关联订单、申请日期、退货原因和处理方式”，且未创建单据。
- 本轮没有在 RISEMAP 或 Forge 提交退货。RISEMAP 零数据与 Forge 历史数据尚未形成同材料；同视口差异图、窄屏量化、同一 SQLite 停服重启和独立复核尚未完成，因此本页继续保持 `review_required`。
