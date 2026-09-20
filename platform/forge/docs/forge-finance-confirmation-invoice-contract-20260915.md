# 财务业务确认与发票管理页面合同（2026-09-15）

## 证据边界

本轮通过已登录的内置浏览器实时打开 RISEMAP 与 Forge 页面。RISEMAP 当前页面均为空数据，因此首屏入口、标题、筛选、指标、列表列和空态属于已观察事实；依赖行数据才出现的按钮、弹窗、阻断和提交结果仍是待同材料复核项。Forge 的现有业务数据与办理 Action 只证明 Forge 能力，不反向解释为 RISEMAP 规则。

## 业务确认

| 页面 | RISEMAP 当前入口与事实 | Forge 页面与处理 | 主原型 | 下一步 |
| --- | --- | --- | --- | --- |
| 销售收入确认 | `/finance/revenue-recognition`；确认日期、状态、客户、项目、确认方式、制单人筛选；导出、批量审核；展示来源订单、净确认额、累计/订单、剩余、财务期间、开票状态与审核信息 | `page_revenue_recognition`；保留按发货/开票来源创建与审核，继续标记批量审核和空数据行交互为待对照 | `task_workspace` | 成本中心 |
| 成本中心 | `/finance/cost-center`；成本归集与结果看板；成本总额、已归集、待归集、待处理、已完成、归集率；来源、客户、合同/项目、已归集和剩余金额 | `page_finance_cost_center`；补客户、已归集金额、剩余金额，读取真实项目成本池 | `workbench` | 费用中心 |
| 费用中心 | `/finance/expense-center`；企业支出/费用统计；日期、类别、状态筛选；新建付款申请；列含申请日期、费用归属、收款方、付款事由、紧急和状态 | `page_finance_expense_center`；承接真实付款任务，补申请日期、费用归属和付款事由；紧急字段尚无 Forge 数据定义 | `task_workspace` | 报销管理 |
| 报销管理 | `/finance/reimbursement`；成本归属、本人/代人、待提交/待审核/审核中/已通过/已驳回/已打款/已作废；列含提交日期、关联对象、供应商 | `page_finance_reimbursement`；按 Forge 现有状态模型合并展示为“审批中”，并补提交日期、关联项目和供应商，继续使用项目费用报销 Action；RISEMAP 将待审核与审核中分列，Forge 尚无领取审核动作 | `task_workspace` | 待对账池 |
| 待对账池 | `/finance/reconciliations`；刷新、批量生成、导出；按往来单位、合同、订单、发货、发票、收付款维度聚合 | `page_reconciliation_pool`；独立入口，复用已实现的冻结来源选择和生成对账单动作 | `task_workspace` | 客户或供应商对账 |
| 客户对账 | `/finance/reconciliations/list/customer`；草稿、待发送、已发送待确认、已确认、有差异；应收期初、本期应收、本期收款、期末应收和差异 | `page_customer_reconciliation`；独立入口，支持生成、登记发送、确认、关闭差异和重新发起 | `task_workspace` | 形成确认结果 |
| 供应商对账 | `/finance/reconciliations/list/supplier`；字段语义对应应付与付款 | `page_supplier_reconciliation`；独立入口，支持相同状态动作并使用应付来源 | `task_workspace` | 形成确认结果 |

## 发票管理

| 页面 | RISEMAP 当前入口与事实 | Forge 页面与处理 | 主原型 | 下一步 |
| --- | --- | --- | --- | --- |
| 发票总览 | `/finance/invoices/overview`；本月/本季/半年/全年；销项、进项、预计应交税、未开票；月度趋势、税额构成和三个办理入口 | `page_invoice_overview`；读取真实进销项和税额，趋势与构成的图形呈现仍需逐页设计验收 | `workbench` | 销项、进项或任务 |
| 销项发票 | `/finance/invoices/sales`；总额、未税、税额、专票占比；正常/作废/红冲；含税、税率、税额、不含税、关联单据、项目和备注 | `page_output_invoices`；补税额、不含税、项目、备注列，开票从销售业务发起 | `task_workspace` | 回款或调整检查 |
| 进项发票 | `/finance/invoices/purchase`；类型、抵扣状态、批量选择待抵扣发票；同样展示税额、不含税、关联单据、项目和备注 | `page_input_invoices`；补金额拆分、项目、票种、抵扣状态和备注；新增认证抵扣/不抵扣动作及标准确认弹窗。已用 Forge 真实进项发票完成页面提交、成功反馈和同一 SQLite 重启回读；RISEMAP 当前无可办理行，行级同材料对照仍待复核 | `task_workspace` | 应付付款或差异检查 |
| 开票任务 | `/finance/invoices/tasks`；待审批、已审批、已开票、已驳回；列含合同/订单、发票类型、税率、申请人和申请时间；页面只刷新 | `page_invoice_tasks`；移除财务页发起申请按钮，补合同/订单、类型、税率和申请时间，保留审批、驳回、登记开票行操作 | `task_workspace` | 正式发票 |
| 调整记录 | `/finance/invoices/adjustments`；展示任务确认或发票详情产生的价税合计、不含税和税额调整及原因 | `page_invoice_adjustments`；独立于红冲，根据已审批申请与正式发票的金额差异形成可追溯记录 | `analysis` | 查看来源申请和发票 |
| 税率差异留痕 | `/finance/invoices/tax-variances`；方向、日期筛选；记录约定/实际税率、估算/实际税额、差异和原因 | `page_invoice_tax_variances`；对照订单行与发票行真实税率计算差异，不用红冲记录替代 | `analysis` | 回到来源订单或发票 |

## Forge 产品决策

- `page_invoice_reversal` 保留为“发票冲销（Forge）”，不再占用 RISEMAP“调整记录”的菜单语义。
- `page_collection_settlement_workspace` 保留为“开票与结算（Forge）”，用于现有端到端结算闭环。
- RISEMAP 当前空数据无法证明调整、税率差异、抵扣和批量审核的行级交互；这些项只有获得同一组可办理材料并完成两侧操作后才能改为对照通过。
