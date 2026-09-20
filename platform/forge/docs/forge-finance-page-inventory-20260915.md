# Forge 财务页面逐页清单（2026-09-15）

## 判定口径

- 本清单来自 2026-09-15 在内置浏览器中实时打开的 RISEMAP 财务页面和 Forge `http://localhost:4421` 独立环境。
- `RISEMAP 当前事实` 只记录当前页面可见入口、首屏结构、筛选、列、空态和已经存在的数据，不推断未实际办理的审批或冲销结果。
- `Forge 当前表现` 是 `origin/main@e8b4914` 的现状。页面可打开、API 可读取或已有业务 Action，不代表页面设计已经验收。
- 21 页当前全部保持 `review_required`；只有逐页完成双侧对照、真实交互、桌面与窄屏检查、API 和同 SQLite 重启回读后才可改为 `accepted`。

## 全量页面清单

| Forge 页面 | RISEMAP 当前入口与事实 | Forge 当前表现 | 占位、功能或样式缺口 | 主原型 | designStatus |
| --- | --- | --- | --- | --- | --- |
| `page_fund_accounts` | `/finance/bank-accounts`；总余额、活跃数、账户数、余额趋势；名称搜索、类型/状态、卡片/表格视图和新增账户 | 真实账户列表、三个指标、新建账户弹窗、单一状态筛选 | 缺搜索、类型筛选、视图切换和趋势；页面仍是通用表格壳 | `configuration` | `review_required` |
| `page_bank_flow` | `/finance/bank-flow`；流水/已分配/待分配/待审核指标，状态页签，账户/收支/类型/时间筛选，批量审核与导出 | 可登记银行流水、勾兑和审核，含财务期间 | 业务能力丰富但首屏被两组长表单占据；缺 RISEMAP 的任务筛选和列表优先层级 | `task_workspace` | `review_required` |
| `page_bank_statement` | RISEMAP 导航未单列独立页面；资金流水承担银行侧流水管理 | 独立 CSV 暂存、校验、导入和余额核对页 | Forge 产品扩展；需明确入口关系并把批次任务放在表单前 | `task_workspace` | `review_required` |
| `page_opening_balance` | `/finance/accounts` 内含期初应收、期初应付和往来对冲页签 | 独立期初建账与对冲页；本轮出现认证失败提示 | 页面职责可保留，但要修加载认证反馈并对齐应收应付入口关系 | `task_workspace` | `review_required` |
| `page_receivables_payables` | `/finance/accounts`；应收/应付/对冲/期初页签，搜索、账龄、来源、日期、余额、发票、业务员和到期提醒 | 应收/应付两个页签、四指标、状态筛选与通用表格 | 大量筛选、视图维度和列缺失；未形成账龄判断工作区 | `analysis` | `review_required` |
| `page_customer_prepayment` | `/finance/payment-collections`；预收款管理入口，待确认/全部/按客户/订单预收维度，余额/已冲抵/客户数/笔数和两个 Top 区 | 真实预收登记、确认、应收冲抵和客户退款；所有表单常驻首屏 | RISEMAP 的汇总层级被办理表单淹没；缺维度切换、Top/空态和弹窗式办理 | `task_workspace` | `review_required` |
| `page_purchase_payment` | `/finance/payment-writeoffs`；付款任务/预付款管理页签，业务说明、批量登记付款、导出、状态/来源和任务列表 | 真实付款申请、审批、登记、核销、撤销以及预付流程；所有表单常驻 | 缺任务列表优先、状态/来源筛选、批量办理与清楚的当前下一步；窄屏长表格风险 | `task_workspace` | `review_required` |
| `page_supplier_refund` | `/finance/refunds`；客户退款/供应商退款页签及数量、导出、状态筛选、12 列列表和空态 | 已基本复刻列表、双页签、导出、分页，并保留真实办理区 | 办理区仍是列表下方长表单；需改为行内进入标准弹窗，检查窄屏和筛选反馈 | `task_workspace` | `review_required` |
| `page_credit_management` | `/finance/credit-management`；授信客户/待审批，额度、占用、可用、使用率、超期、冻结和负责人 | 通用四指标、两个页签、申请授信弹窗和部分审批动作 | 列、风险判断与冻结维度不完整；通用模板缺岗位任务层级 | `task_workspace` | `review_required` |
| `page_finance_loans` | `/finance/loans`；员工借款/银行贷款、申请借款、状态筛选；当前有 `BOR-2026-0001` 审核中记录 | 通用四指标、两个页签、借款/贷款弹窗和状态动作 | 需按当前真实记录复核详情、审批进度和动作出现条件；通用模板缺详情承接 | `task_workspace` | `review_required` |
| `page_revenue_recognition` | `/finance/revenue-recognition`；日期、状态、客户、项目、确认方式、制单人筛选，导出/批量审核和完整确认列表 | 可从发货/发票来源生成确认单并审核 | 表单先于主列表，缺大部分筛选、导出和批量审核；首屏任务顺序不符 | `task_workspace` | `review_required` |
| `page_finance_cost_center` | `/finance/cost-center`；成本归集/结果看板，六项指标，待归集/结转/确认分类，来源和状态筛选 | 通用指标、三个页签和成本表格 | 缺结果看板、来源筛选和归集率解释；仍是通用生成页 | `analysis` | `review_required` |
| `page_finance_expense_center` | `/finance/expense-center`；时间粒度和范围、企业支出/费用统计、新建付款、类别/状态筛选 | 通用四指标、两个页签和付款入口 | 时间范围、类别和统计视图缺失；通用模板不能表达费用分析 | `timesheet_composite` | `review_required` |
| `page_finance_reimbursement` | `/finance/reimbursement`；月份/自定义范围、四指标、费用归属、本人/代人、状态筛选和新建报销 | 通用四指标、三个页签、状态筛选和报销入口 | 时间、归属、报销人维度缺失；列表壳不能表达办理与统计关系 | `timesheet_composite` | `review_required` |
| `page_counterparty_reconciliation` | `/finance/reconciliations`、`/list/customer`、`/list/supplier`；待对账池及客户/供应商清单、维度、期间、状态和导出 | 独立待对账池、生成和确认能力 | 页面职责与 RISEMAP 三入口关系需拆清；本轮加载较慢，需复核错误/空态 | `task_workspace` | `review_required` |
| `page_invoice_overview` | `/finance/invoices/overview`；月/季/半年/全年，销项/进项/预计税额/未开票，趋势、税额构成和三入口 | 四指标、时间页签和一张通用发票表 | 缺趋势、税额构成和三个明确下一步入口；通用表格破坏总览职责 | `workbench` | `review_required` |
| `page_output_invoices` | `/finance/invoices/sales`；时间、导出、四指标、状态页签和发票明细 | 通用四指标、状态页签、申请开票入口 | 缺时间筛选、导出、邮件/项目等列；表格和空态需要逐项对照 | `task_workspace` | `review_required` |
| `page_input_invoices` | `/finance/invoices/purchase`；时间、邮件收票、导出、四指标、状态页签、搜索、类型/抵扣状态和批量抵扣 | 通用四指标、状态页签、登记入口 | 缺时间、搜索、类型/抵扣、批量动作和邮件收票边界；通用模板不足 | `task_workspace` | `review_required` |
| `page_invoice_tasks` | `/finance/invoices/tasks`；时间、待处理/待开金额/全部申请，状态页签、刷新和任务列表 | 真实申请、审批、驳回和开票动作，通用四指标列表 | 缺时间范围与 RISEMAP 列；动作与详情需要独立任务工作区 | `task_workspace` | `review_required` |
| `page_invoice_reversal` | `/finance/invoices/adjustments` 与 `/tax-variances`；调整指标、差异页签、日期范围；税率差异按方向/日期查询 | Forge 合并为财务冲销，支持红冲和冲抵撤回；本轮出现认证失败提示 | 错误复用：RISEMAP 两个审计查询入口被一个操作页替代；需拆分展示与冲销入口 | `task_workspace` | `review_required` |
| `page_collection_settlement_workspace` | RISEMAP 财务菜单无同名聚合页；能力分别位于开票任务、收款、对账等页面 | Forge 产品扩展，串联验收开票、收款、核销和项目结算 | 聚合页可保留，但需明确为 Forge 工作区并减少首屏常驻表单；不能替代 RISEMAP 原入口 | `task_workspace` | `review_required` |

## 首批处理顺序

1. `page_customer_prepayment`：保留 RISEMAP 的汇总与维度首屏，把登记、确认、冲抵和退款移入上下文弹窗。
2. `page_purchase_payment`：以付款任务列表为核心，补齐来源/状态筛选，把申请、审批、付款、核销和撤销按当前记录状态进入弹窗。
3. `page_supplier_refund`：保留当前较接近 RISEMAP 的列表骨架，把实际收付和核销从常驻表单改成选中记录后的标准办理弹窗。

三页均以 `project-task-workspace.page.ts` 为主参考，复用 `product-ui.ts` 控件与状态反馈；业务字段、状态和阻断继续沿用现有已验证 Action。RISEMAP 当前无可办理退款和预收记录，因此最终仍需同材料复核，状态暂不改为 `accepted`。
