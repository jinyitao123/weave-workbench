# 财务对账并行精校合同

- 最新执行约束：用户改为逐页慢慢看。本批现在只处理 `page_revenue_recognition`，其余 8 个入口仅保留待办，未实施。收入确认页面门禁未齐前不进入下一页。
- 起始版本：`cf56502c4e7ceac1b01a77b4aa9f9cbe39149b7a`；分支 `codex/finance-reconciliation-parallel-20260920`。
- 运行环境：`http://localhost:4443`；独立 SQLite `.objectstack/finance-reconciliation-parallel.sqlite`。
- 目标：逐页补齐像素级和可办理性证据。所有页面仍为 `review_required`，未完成的同材料对照、独立复核不能由工程检查代替。
- 使用 Skill：`objectstack-ui`（页面源与入口）、`objectstack-query`（查询和分页审查）、`objectstack-platform`（独立 CLI 运行环境）。共享组件、导航、manifest 由主线维护。

## 页面范围与岗位合同

| 页面 | 当前参考入口 | 岗位任务 / 主原型 | 首屏顺序、主动作和下一步 | 本轮要求 |
| --- | --- | --- | --- | --- |
| page_revenue_recognition | /finance/revenue-recognition | 财务审核收入 / task_workspace | 标题、筛选、批量审核、确认列表、分页；审核后进入收入结果 | RR-01 每页 10 条真实分页；RR-02 审核意见缺失的可见阻断；窄屏筛选不能撑宽 |
| page_reconciliation_pool | /finance/reconciliations | 往来会计选择来源 / task_workspace | 待对账池、方向、范围、维度、来源；生成进入对应对账单 | RC-01 独立入口默认待对账池 |
| page_customer_reconciliation | /finance/reconciliations/list/customer | 应收会计对账 / task_workspace | 客户对账、状态、搜索、维度、列表；进入办理 | RC-02 标准 pageName 入口正确显示客户对账 |
| page_supplier_reconciliation | /finance/reconciliations/list/supplier | 应付会计对账 / task_workspace | 供应商对账、状态、搜索、维度、列表；进入办理 | RC-03 标准 pageName 入口正确显示供应商对账 |
| page_counterparty_reconciliation | Forge 决策，复用待对账池事实 | 往来会计综合办理 / task_workspace | 范围、来源、生成、发送与确认 | 保留已有功能，待同材料复核 |
| page_invoice_adjustments | /finance/invoices/adjustments | 发票审核员追溯金额调整 / analysis | 调整记录、指标、筛选、明细 | IA-01 独立调整记录入口 |
| page_invoice_tax_variances | /finance/invoices/tax-variances | 发票审核员追溯税率差异 / analysis | 税率差异标题、方向/来源/发票/日期、明细或空态 | IA-02 标准 pageName 入口必须呈现税率差异页面 |
| page_invoice_reversal | Forge 产品决策 | 财务红冲 / task_workspace | 方向、依据、影响确认、结果 | 本轮只读审查，RISEMAP 无对应复刻入口 |
| page_collection_settlement_workspace | Forge 产品决策 | 财务与项目结算 / task_workspace | 岗位页签、表单、结果、下一岗位 | 本轮只读审查，RISEMAP 无对应复刻入口 |

主原型参考 `project-task-workspace.page.ts`，分析层级参考 `workbench.page.ts`；引用只是结构参考，样例桌面与窄屏截图尚待采集。对账、收入确认和审计列/状态以 `docs/forge-finance-confirmation-invoice-contract-20260915.md` 为历史辅助；当前业务规则优先使用本轮实时事实。

## 本轮当前事实

- 对账子任务内置浏览器访问 RISEMAP 待对账池跳登录页；Edge 连接连续策略错误。主线在同一轮已登录 Edge 代为实时读取税率差异和收入确认，传回的事实如下。此证据属于本轮主线观察，不伪称子任务独立办理。
- 税率差异当前标题、说明、方向（全部/销项/进项）、来源单号、发票号码、差异时间起止、共 0 条及“暂无税率差异留痕”空态已观察。
- 收入确认当前有两层标题，搜索、确认日期起止、状态/客户/项目/确认方式/制单人、导出与批量审核、15 列与每页 10 条分页；当前空数据，不能证明审核动作成功。
- 主线本轮实时事实文件：`docs/evidence/finance-parallel-20260920/live-comparison.md`，销售收入确认一节。该文件在主工作树，由主线集成，截图及像素差分仍缺。
- 子任务内置浏览器实际打开 Forge `page_invoice_tax_variances`，导航正确但内容标题为“调整记录”，证明标准入口模式错误。

## 明确 Forge 决策

- 每个已注册 pageName 固定其业务模式，不再依赖已移除的 `nav` 参数。
- 必填审核意见缺失必须在弹窗内显示原因，不能静默返回。批量审核只作用于当前筛选范围中仍待审核的记录。
- 未具备双侧同材料与独立复核的页面保留待复核；分页和模式修复不改变财务账或引入 RISEMAP 未观察业务规则。

## 四维状态与差异记录

replication：pending；visual：pending；interaction：pending；business：pending。几何、字号、间距、颜色、状态截图及叠图差异尚待主线截图文件和独立分支取证。桌面目标 1440×900，窄屏目标 390×844。参考系统空数据意味着真实有数据、异常、审核和下一岗位仍待同材料复核。
