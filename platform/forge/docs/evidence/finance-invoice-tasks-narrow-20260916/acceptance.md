# 开票任务窄屏整改验收记录（部分证明）

- 页面：`page_invoice_tasks`
- 主原型：`task_workspace`；参考 `project-timesheet-cost.page.ts`
- 页面源码：`apps/forge-objectstack/src/pages/finance-management.page.ts`
- 被验收版本：`aa9429`
- 环境：`http://localhost:4441`；`apps/forge-objectstack/.objectstack/finance-sales-cycle.sqlite`
- 业务材料：库内真实开票申请（全部申请 5 条、待处理开票 1 条、待开票金额 12,000.00）
- 设计状态：`review_required`

## 本轮实时打开并核对的页面

- Forge：`http://localhost:4441/_console/apps/forge/page/page_invoice_tasks?nav=invoice_tasks`，桌面 1440×900 与窄屏 390×844。
- 本轮首次改用无头 Chrome CDP 会话（独立临时 profile、本地 dev 账号登录）完成核对，因为内置浏览器通道当轮不可用；这是工具替代，不是页面事实差异。
- RISEMAP：`https://risemap.cn/finance/invoices/tasks` 本轮未重新打开，期间页签、指标名称与空态引用页面合同中的前次实时观察。

## 已证明事实

1. 期间选择在指标之前：桌面实测期间区顶部 208px、指标区顶部 267px，符合“影响整页统计的范围选择放在指标之前”。
2. 期间起止含义明确：窄屏显示“2026-01-01 至 2026-12-31（按申请提交时间）”。
3. 行操作不折行：明细行操作按钮 `white-space` 实测为 `nowrap`。
4. 窄屏指标不再堆积：390×844 下任务指标由修复前单列 322px（块高 271px）改为两列 157px（块高 178px），列表标题由修复前 622px 上移到 530px。
5. 记录数量不再被挤压：列表标题行在窄屏为 `flex-wrap: wrap`，“开票申请列表”与“共 5 条”各自完整显示。
6. 窄屏无横向溢出：`scrollWidth` = `clientWidth` = 390；期间页签与状态页签各自在行内横向滚动。

## 证据文件

- 桌面 1440×900：`docs/evidence/finance-invoice-tasks-narrow-20260916/tasks-desktop-1440x900.png`
- 窄屏 390×844 修复前（旧规则复现）：`docs/evidence/finance-invoice-tasks-narrow-20260916/tasks-narrow-390x844-before.png`
- 窄屏 390×844 修复后：`docs/evidence/finance-invoice-tasks-narrow-20260916/tasks-narrow-390x844-after.png`

## 残余缺口

- 窄屏结论由无头 Chrome 复测得出，严格按项目规定在内置浏览器复核同一视口仍待补一次确认。
- 状态页签在 390px 下最后一个页签需要横向滚动才能看到，尚未增加滚动提示；当前不构成重叠或挤压，但体验可继续优化。
- RISEMAP 当前无开票申请数据，行操作出现条件、弹窗与提交反馈仍无法同材料对照。
- 独立验收尚未发生。
- 实际耗时、调用与费用：无可靠统一来源，记为未知。

## 四维结果

| 维度 | 结果 | 说明 |
| --- | --- | --- |
| replication | blocked | RISEMAP 无数据且本轮未重新打开；结构与文案引用前次观察。 |
| visual | pass | 桌面与窄屏结构、密度与可读性实测通过；独立视觉复核未发生。 |
| interaction | pass | 期间切换、搜索、页签与行操作此前已实际操作；本轮补充窄屏可用性实测。 |
| business | blocked | 页面办理与 API、重启回读证据在本批其他记录中；RISEMAP 同材料办理不可用。 |
