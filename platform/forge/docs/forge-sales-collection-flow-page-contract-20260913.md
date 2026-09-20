# 收款流水页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“收款流水”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 页面入口

- RISEMAP 收款流水：`https://risemap.cn/sales/collection-flow`
- Forge 收款流水：`http://localhost:4321/_console/apps/forge/page/page_sales_collection_flow`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 收款流水”，标题为“收款流水”，页面说明为“展示收款资金流水 · 手动分配到销售订单 · 核销前可解绑 · 分配后刷新订单回款进度”。首屏指标包含收款流水总额、已分配金额、未分配金额和待分配。状态页签包含“全部”“待分配”“部分分配”“已分配”。筛选项包含搜索流水号或订单、按对方名称筛选、按金额筛选、全部客户和日期范围。表头列为：流水号、往来单位/客户、收款日期、方式、收款账户、收款金额、已分配 / 未分配、状态、操作。

当前账号下列表为空，显示“暂无收款流水”。本轮没有在 RISEMAP 登记到账或分配收款，因此不能把分配成功、取消分配或撤销到账写成 RISEMAP 已观察事实。

## Forge 改造前差异

Forge 销售菜单中的“收款流水”此前指向销售占位页，不能按 RISEMAP 当前页展示资金流水指标、状态页签、筛选区和列表列，也不能从销售侧进入收款分配办理。

## Forge 本轮实现

- 新增业务工作区 `page_sales_collection_flow`，并把销售业务下的“收款流水”入口指向该页面。
- 页面读取 `forge_cash_receipt`、`forge_collection_allocation`、`forge_accounts_receivable`、`forge_sales_order`、`forge_sales_invoice`、`forge_customer`、`forge_fund_account` 和 `sys_user`。
- 首屏对齐 RISEMAP 的指标、四个状态页签、搜索/对方/金额/日期筛选和表头列。
- 有收款流水时可在销售侧执行“分配到订单”；生成待审核核销记录后，核销前可“取消分配”。
- “撤销到账”属于破坏性财务动作，使用二次确认弹窗，明确显示会撤销实际到账并从原资金账户扣回同额余额。
- 日期筛选和业务选择使用 ObjectStack Console 共享组件，不使用浏览器原生下拉或日期选择器。

## 分层说明

RISEMAP 当前页面没有可办理数据，本轮只能完成入口、首屏结构、筛选、表头和空态对照。Forge 的分配、取消分配和撤销到账来自既有财务动作能力，是本地可写执行扩展；后续需要在 RISEMAP 出现可办理流水后做同材料对照。

## 浏览器证据

- RISEMAP 收款流水：`risemap-sales-collection-flow.ax.txt`、`risemap-sales-collection-flow.png`。
- Forge 收款流水：`forge-sales-collection-flow.ax.txt`、`forge-sales-collection-flow.png`。

## 当前结论

“收款流水”已经从销售占位入口推进为可对照的业务工作区。当前可验收范围是 RISEMAP 已观察到的收款流水首屏结构、指标、页签、筛选、表头和空态；收款登记、分配、取消分配和撤销到账仍需在有 RISEMAP 同材料可办理数据后复核。
