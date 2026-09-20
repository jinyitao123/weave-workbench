# 财务发票页面精修记录

本分支范围为财务确认、发票、对账、冲销、收款与结算页面。页面仍保持 `review_required`，因为当前执行环境没有可调用的内置浏览器工具，无法完成 RISEMAP 实时页面与 Forge 页面逐页操作证据；没有把静态代码检查当作页面验收。

## 本轮已修改

- `finance-management.page.ts`：财务通用页指标改为自适应列，筛选栏在窄屏换行，表格与空态使用统一产品间距；成本中心五项指标不再溢出或孤立换行。
- `revenue-recognition.page.ts`：收入确认页改用与工时成本页一致的内容宽度、卡片圆角、输入控件高度和自适应指标布局。
- `counterparty-reconciliation.page.ts`：待对账池、客户/供应商对账共用统一卡片、筛选表单和窄屏布局。
- `invoice-reversal.page.ts`：冲销参数和审计区使用统一卡片、控件和状态提示尺寸。
- `collection-settlement-workspace.page.ts`：开票、收款、分配和项目结算区统一内容宽度、圆角、指标及表格容器。

## 逐页状态

| 页面 | 状态 | 未决证据 |
| --- | --- | --- |
| `page_revenue_recognition` | review_required | RISEMAP 当前页、同材料生成/审核、Forge 页面提交回读 |
| `page_finance_cost_center` | review_required | RISEMAP 当前页、成本筛选/状态切换、窄屏检查 |
| `page_finance_expense_center` | review_required | RISEMAP 当前页、费用统计切换、主操作页面回读 |
| `page_finance_reimbursement` | review_required | RISEMAP 当前页、报销状态路径、异常阻断 |
| `page_counterparty_reconciliation` | review_required | RISEMAP 当前页、客户/供应商对账确认与差异关闭 |
| `page_invoice_overview` | review_required | RISEMAP 当前页、期间切换与税额明细来源 |
| `page_output_invoices` | review_required | RISEMAP 当前页、销项列表与开票衔接 |
| `page_input_invoices` | review_required | RISEMAP 当前页、票种/抵扣筛选与认证回读 |
| `page_invoice_tasks` | review_required | RISEMAP 当前页、审批/登记开票/发票查看 |
| `page_invoice_reversal` | review_required | RISEMAP 当前页、红冲与冲抵撤回确认弹层 |
| `page_collection_settlement_workspace` | review_required | RISEMAP 当前页、开票-收款-分配-结算连续办理 |

## 验证边界

本记录只描述代码层精修，不声称 RISEMAP/Forge 页面已对照通过。提交前运行项目要求的 `pnpm typecheck`、`pnpm validate`、`pnpm build` 及页面静态检查；浏览器证据补齐后，按页面逐条登记证据路径，才能将状态改为 `accepted`。
