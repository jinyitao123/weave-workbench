# 资金账户页验收记录（部分证明）

- 页面：`page_fund_accounts`
- 主原型：`configuration`；参考 `project-timesheet-cost.page.ts`
- 页面源码：`apps/forge-objectstack/src/pages/finance-management.page.ts`
- 被验收版本：`aa9429`
- 环境：`http://localhost:4441`；`apps/forge-objectstack/.objectstack/finance-sales-cycle.sqlite`
- 业务材料：账户 `应收页面验收账户`（FA-AR-PAGE-20260916，当前余额 126,000.00）与本次新建的银行账户
- 设计状态：`review_required`

## 本轮实时打开并核对的页面

- Forge：`http://localhost:4441/_console/apps/forge/page/page_fund_accounts?nav=fund_accounts`（内置浏览器）
- Forge 窄屏复测：同一地址在 390×844 下改用无头 Chrome CDP 会话（独立临时 profile、本地 dev 账号登录），因为内置浏览器通道在本轮中途不再可用；这是工具替代，不是页面事实差异。
- RISEMAP：本轮未重新打开。字段清单、页签结构和空态引用页面合同中记录的前次实时观察，不据此宣称复刻通过。

## 已证明事实

1. 新增账户弹窗在重建后包含观察到的全部字段，顺序与 RISEMAP 观察一致：账户类型、开户银行、开户支行、银行账户类型、账户名称、账户号码、币种、账户编码、期初余额、期初时间、客户经理、联系电话、允许打印、可见范围、备注。账户类型改为非银行时，开户银行、开户支行、银行账户类型隐藏，账户号码保留。
2. 空表单提交被阻断，弹窗提示“请填写账户名称、账户类型、有效的期初余额和期初日期”。
3. 只填账户名称与期初余额提交被阻断，弹窗提示“银行账户必须填写开户银行和账户号码”。
4. 完整填写后创建成功，页面提示“资金账户已创建”，列表即时回读新账户。
5. API 回读（新建后、停服重启后一致）：账户编码留空自动生成为 `FA-1789552353699`，期初余额 8,800.00 由钩子写入当前余额 8,800.00，开户支行、账号、客户经理、联系电话、允许打印、可见范围、期初时间均按填写值保存，状态为启用。
6. 搜索 `验收 B` 命中 1 条；搜索 `NO-MATCH-XYZ` 显示“暂无匹配的账户”空态与“共 0 条”；重置筛选恢复 2 条。
7. 账户类型筛选“微信”结果为 0 条，重置后恢复 2 条；卡片视图与表格视图显示同一结果集，表格列出 `FA-AR-PAGE-20260916` 与 `FA-1789552353699`。
8. 停服后用同一 SQLite 重启，账户与余额回读一致；既有账户 `应收页面验收账户` 当前余额 126,000.00 未受影响。
9. 工程门禁：`pnpm typecheck`、`pnpm validate`、`pnpm build` 通过，构建后导航静态检查 211 个入口通过；`pnpm acceptance:page-polish` 通过；`node --test tests/page-delivery-gate.test.mjs` 9/9 通过。
10. 窄屏 390×844 复测：指标区为 157px 两列，指标块高度由修复前 433px 降到 214px，列表标题由修复前 684px 上移到 466px，页面无横向溢出（`scrollWidth` = `clientWidth` = 390），仍显示 2 条真实账户；对照用旧规则在当前页内复现，前后截图同视口同数据。
11. 窄屏新增账户弹窗：修复后弹窗顶部 12px、高度 820px、底部操作栏固定在 832px，正文可滚动加载全部字段，`创建账户` 不滚动即可见；点击后仍返回阻断提示“请填写账户名称、账户类型、有效的期初余额和期初日期”。修复前弹窗顶部为 -404px、底部按钮在视口之外。

## 证据文件

- 桌面卡片视图：`docs/evidence/finance-fund-accounts-20260916/desktop-card-view.png`
- 桌面表格视图：`docs/evidence/finance-fund-accounts-20260916/desktop-table-view.png`
- 窄屏 390×844 指标压缩前（旧规则复现）：`docs/evidence/finance-fund-accounts-20260916/narrow-390x844-before.png`
- 窄屏 390×844 指标压缩后：`docs/evidence/finance-fund-accounts-20260916/narrow-390x844-after.png`
- 窄屏 390×844 新增账户弹窗：`docs/evidence/finance-fund-accounts-20260916/narrow-390x844-account-dialog.png`
- 内置浏览器留下的窄屏修复前截图：`docs/evidence/finance-fund-accounts-20260916/narrow-390x844-before-in-app-browser.png`

## 残余缺口

- 窄屏结论由无头 Chrome 复测得出；若需要严格按项目规定在内置浏览器复核同一视口，仍待补一次确认。
- 弹窗窄屏修复目前是本页隔离补丁（`.finance-page .fp-modal-*`）。同类问题影响所有使用 `ForgeDialog` 的页面，`product-ui.ts` 的共享修复建议是给 `.fp-modal` 增加 `max-height:calc(100vh - 24px)` 与纵向弹性布局、`.fp-modal-body` 增加 `overflow:auto`，并让 `.fp-modal-backdrop` 在 760px 以下顶部对齐；是否落入共享文件由集成负责人决定。
- RISEMAP 当前账号没有账户记录，卡片/表格有数据布局、详情、编辑、停用、期初余额冻结与后续流水行为无法同材料对照，只能标为待 RISEMAP 复核。
- 独立验收尚未发生。
- 实际耗时、调用与费用：无可靠统一来源，记为未知。

## 四维结果

| 维度 | 结果 | 说明 |
| --- | --- | --- |
| replication | blocked | RISEMAP 无账户数据且本轮未重新打开；字段清单与空态来自前次观察。 |
| visual | pass | 桌面卡片、表格、有数据与空态在内置浏览器核对；窄屏 390×844 指标与弹窗在无头 Chrome 复测通过。独立视觉复核未发生。 |
| interaction | pass | 阻断、创建、搜索、类型筛选、视图切换、重置与窄屏弹窗操作均通过。 |
| business | pending | 新建与同库停服重启回读通过；同材料 RISEMAP 办理与独立验收待完成。 |
