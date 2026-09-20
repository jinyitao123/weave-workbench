# 财务窄屏指标区整改验收记录（部分证明）

- 范围：`page_bank_flow`、`page_receivables_payables`、`page_invoice_overview`、`page_output_invoices`、`page_invoice_adjustments`
- 被验收版本：`a08bc26`
- 环境：`http://localhost:4461`；`apps/forge-objectstack/.objectstack/finance-page-polish2.sqlite`
- 合同：`docs/forge-finance-narrow-metrics-20260917.md`
- 设计状态：五页均保持 `review_required`

## 工具与实际做法

- 内置浏览器通道本轮不可用（`Unable to load browser request-header policy`），改用无头 Chrome（Playwright 缓存的 chrome-headless-shell）通过 CDP 打开本分支环境，使用本地 dev 账号登录，视口 390×844，`mobile: true`。
- 每个页面在整改前后各取一张同视口整页截图，并读取指标容器的 `grid-template-columns`、高度与页面 `scrollWidth/clientWidth`。
- 之前已提交到 main 的 `docs/evidence/finance-narrow-sweep-20260916/` 提供整改前的四页截图，本批补充 `page_bank_flow` 与 `page_invoice_adjustments` 的整改前截图。

## 实测结果

| 页面 | 指标容器 | 整改前 | 整改后 | 横向溢出 |
| --- | --- | --- | --- | --- |
| `page_bank_flow` | `.metric-grid.ledger-metrics` | 322px 单列，块高 457 | 157px 两列，块高 190 | 无 |
| `page_receivables_payables` | `.account-ledger-summary` | 322px 单列，块高 394 | 157px 两列，块高 178 | 无 |
| `page_invoice_overview` | `.invoice-overview-metrics` | 322px 单列，块高 482 | 157px 两列，块高 217 | 无 |
| `page_output_invoices` | `.invoice-ledger-summary` | 322px 单列，块高 374 | 157px 两列，块高 178 | 无 |
| `page_invoice_adjustments` | `.fp-metrics` | 342px 单列，块高 271 | 167px 两列，块高 174 | 无 |

## 全量财务入口排查

- 覆盖财务导航 25 个入口，逐页读取指标容器列数、主工作区 `top`、`scrollWidth` 与 `clientWidth`。
- 结论：整改后没有入口出现指标区单列堆叠，也没有入口出现横向溢出。
- 仍偏深的页面（单列指标已修复，但首屏结构仍需逐页评估）：`page_bank_statement` 主工作区 1446px、`page_reconciliation_pool` 876px、`page_finance_cost_center` 838px、`page_finance_reimbursement` 681px。

## 工程门禁

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm validate` | 通过（无 error） |
| `pnpm build` | 通过，含导航静态检查 211 个入口 |
| `pnpm acceptance:page-polish` | 通过 |
| `node --test tests/page-delivery-gate.test.mjs` | 9/9 通过 |

## 残余缺口

- 五页没有在本批重新打开 RISEMAP 实时页面，也没有重新办理各自业务链；复刻一致性与业务维度保持未复核。
- 交互维度本轮只证明“窄屏指标布局”不破坏既有结构，没有重新点击各页按钮、筛选与弹窗。
- 独立验收尚未发生。
- 实际耗时、调用与费用：无可靠统一来源，记为未知。
