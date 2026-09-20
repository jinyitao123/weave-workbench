# 财务窄屏指标区整改合同（2026-09-17）

## 批次和范围

- 总目标：财务全部页面精修与业务验收；本批只处理补充要求第 4 条“窄屏不得重叠挤压、压缩指标占位，让用户尽早看到主工作区”。
- 本批页面：`page_bank_flow`、`page_receivables_payables`、`page_invoice_overview`、`page_output_invoices`、`page_invoice_adjustments`。
- 分支与工作树：`codex/finance-page-polish2`；`/Users/jinyitao/Developer/.inoForge-worktrees/finance-page-polish2`。
- 独立环境：`http://localhost:4461`；`file:.objectstack/finance-page-polish2.sqlite`。
- 实现提交：`a08bc26`。规则与视觉基线继承 `docs/forge-page-delivery-standard.md`、`docs/forge-page-polish-baseline.md`。
- 共享文件：本批不修改 `objectstack.config.ts`、`product-ui.ts`、`src/pages/index.ts`、`package.json`；`tests/page-polish.manifest.json` 仅增加本批 5 个页面的 `review_required` 记录，由集成负责人确认。

## 缺陷事实与处理结论

窄屏 390×844 实测（无头 Chrome CDP，dev 账号登录本分支环境）显示五页的指标容器计算列数均为 1 列，指标卡逐张堆叠，把主工作区推到首屏之外或大幅下移。逐页根因：

| 页面 | 原型 | 现状根因 | 处理 |
| --- | --- | --- | --- |
| `page_bank_flow` | analysis | `.bank-flow .metric-grid` 在 680px 断点被改为单列 | 保留两列，表单与筛选仍单列 |
| `page_receivables_payables` | analysis | `.account-ledger-summary` 在 520px 断点被改为单列 | 保留两列并压缩卡片内边距与数字字号 |
| `page_invoice_overview` | workbench | `.invoice-overview-metrics` 在 760px 断点与图表区块一起被改为单列 | 指标保留两列，图表与关联区块继续单列 |
| `page_output_invoices` | task_workspace | `.output-invoice-ledger .invoice-ledger-summary` 在 760px 断点覆盖了共享两列规则 | 保留两列并压缩数字字号 |
| `page_invoice_adjustments` | analysis | `.invoice-audit .fp-metrics` 在 900px 断点被改为单列 | 保留两列紧凑显示 |

## 逐页效果与验证

| 页面 | 主动作与位置 | 窄屏整改前 | 窄屏整改后 | 证据 |
| --- | --- | --- | --- | --- |
| `page_bank_flow` | 标题区“新增流水”/筛选区配流水类型与状态 | 指标 322px 单列，块高 457 | 两列 157px，块高 190 | `bank_flow-narrow-390x844-before/after.png` |
| `page_receivables_payables` | 标题区“往来对冲 / 期初建账”入口 | 指标 322px 单列，块高 394 | 两列 157px，块高 178 | `receivables_payables-narrow-390x844-before/after.png` |
| `page_invoice_overview` | 期间页签与“查看销项发票 / 管理进项发票”入口 | 指标 322px 单列，块高 482 | 两列 157px，块高 217 | `invoice_overview-narrow-390x844-before/after.png` |
| `page_output_invoices` | 标题区“申请开票”，行内“查看发票 / 红冲” | 指标 322px 单列，块高 374 | 两列 157px，块高 178 | `output_invoices-narrow-390x844-before/after.png` |
| `page_invoice_adjustments` | 列表内筛选与行内查看 | 指标 342px 单列，块高 271 | 两列 167px，块高 174 | `invoice_adjustments-narrow-390x844-before/after.png` |

## 全量财务入口排查结果

- 同一次 390×844 排查覆盖财务导航 25 个入口，整改后没有任何入口出现指标区单列堆叠，也没有页面出现横向溢出。
- 排查口径：读取指标容器 `grid-template-columns` 与高度、首个主工作区元素的 `top`、`scrollWidth` 与 `clientWidth` 比较。
- 本轮工具说明：内置浏览器通道不可用（返回 request-header policy 错误），因此使用无头 Chrome CDP 会话登录本地 dev 账号取证；严格按项目规定在内置浏览器复核仍待补。

## 残余缺口

- 五页均为 `review_required`：窄屏布局已证明，但本批没有重新打开 RISEMAP 实时页面做双侧同材料对照，也没有重新办理各页业务链；交互与业务维度沿用此前记录并保持未复核。
- `page_bank_statement` 主工作区仍在 1446px 处（表单在列表之前），`page_finance_cost_center`（838px）、`page_finance_reimbursement`（681px）、`page_reconciliation_pool`（876px）首屏仍以指标与筛选为主，需要按“首屏优先呈现当前任务”单独评估，不在本批范围。
- 独立验收尚未发生。
- 实际耗时、调用与费用：无可靠统一来源，记为未知。

## 工程门禁

- `pnpm typecheck`、`pnpm validate`、`pnpm build`、`pnpm acceptance:page-polish` 与 `node --test tests/page-delivery-gate.test.mjs` 在本批提交上运行，结果见证据目录 `docs/evidence/finance-narrow-metrics-20260917/acceptance.md`。
