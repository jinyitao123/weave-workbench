# 开票任务页面实施验收记录

## 环境与材料

- Forge：`http://localhost:4441/_console/apps/forge/page/page_invoice_tasks?nav=invoice_tasks`
- SQLite：`apps/forge-objectstack/.objectstack/finance-sales-cycle.sqlite`
- RISEMAP：`https://risemap.cn/finance/invoices/tasks`
- 业务材料：`tests/invoice-task-workspace.integration.mjs` 生成的五张独立销售订单及对应开票申请。
- 实施页面源码：`apps/forge-objectstack/src/pages/finance-management.page.ts`

RISEMAP 当前账号在开票任务页没有业务记录。本轮实时确认了标题、说明、四个期间、三项指标、五个状态、刷新、十列表头和空态；行操作、弹窗、阻断及结果仍缺少 RISEMAP 同材料证据。

## Forge 页面操作结果

内置浏览器在 1280×720 可见区域完成以下操作：

1. 全年首屏显示 5 条申请，待审批 2、已审批 1、已开票 1、已驳回 1；待处理开票为 1，待开票金额为 ¥26,000.00。
2. “待审批”页签只显示 2 条记录。点击“审批通过”，空审批意见被页面阻断并显示“审批意见不能为空”；填写意见后提交成功，指标变为待处理开票 2、待开票金额 ¥38,000.00。
3. 对另一条待审批记录执行“驳回”，页面展示业务影响说明，提交后待审批变为 0、已驳回变为 2。
4. “已审批”页签显示 2 条记录。点击“登记开票”，空发票编号被页面阻断并显示“发票编号不能为空”；填写 `INV-BROWSER-20260916-001` 后，页面提示“销项发票与应收已登记”，待开票金额降为 ¥12,000.00。
5. 搜索 `PENDING-APPROVE` 只保留对应记录；“重置筛选”恢复全年、全部和 5 条记录。
6. 完整停服并使用同一 SQLite 重启后，页面仍显示 5 条申请、待处理开票 1、待开票金额 ¥12,000.00、待审批 0、已驳回 2；浏览器登记的申请仍为已开票。
7. 按补充页面要求把期间选择移到指标之前；本月与全年分别显示申请提交时间起止。列表名称和记录数量独立成行，指标区收紧，最右侧操作列固定且行操作不换行。

内置浏览器在 390×844 下继续核对了首屏、状态页签、搜索、无结果空态、重置和“登记开票”弹窗。期间页签与时间范围分行呈现，指标纵向排列，列表与操作没有相互遮挡；宽表只在列表卡片内部横向滚动。登记开票弹窗完整显示对象、必填输入、业务影响、取消和确认按钮，取消后不产生状态变化。窄屏页面证据已补齐，但独立复核尚未发生，因此本页仍保持 `review_required`。

## API 与持久化结果

- `tests/invoice-task-workspace.integration.mjs`：通过。真实执行其他入库、销售订单提交与审批、发货出库、开票申请、审批、驳回、登记开票和应收生成；同时验证未登录、空审批意见、空发票号和错误状态阻断。
- 浏览器操作后 API 回读：通过。`INV-BROWSER-20260916-001` 对应销项发票状态为 `issued`，应收状态为 `unpaid`，发票金额和应收余额均为 26,000。
- `tests/invoice-task-restart-readback.mjs`：通过。完整停服重启后，审批、驳回、开票、发票与应收关联及金额均保持一致。
- `pnpm typecheck`：通过。
- `pnpm validate`：通过；存在项目既有的 react-source `className` 作者期警告，本页未新增 Tailwind 依赖。
- `pnpm build`：通过；构建后导航静态检查通过 211 个菜单入口唯一性。

## 四维结论

- replication：`blocked`。RISEMAP 当前空数据，行级交互和同材料业务结果待复核。
- visual：`pending`。桌面和 390×844 窄屏的有数据、空态、筛选与弹窗均已检查；独立视觉复核待完成。
- interaction：`blocked`。Forge 正常路径与关键阻断已通过；RISEMAP 行级交互待同材料复核。
- business：`blocked`。Forge 的发票与应收结果、API 和重启回读已通过；RISEMAP 同材料结果待复核。

独立复核尚未发生，本记录不构成页面 `accepted`。
