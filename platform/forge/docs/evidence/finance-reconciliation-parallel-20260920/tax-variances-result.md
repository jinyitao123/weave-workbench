# 税率差异留痕单页修复记录

## 结果和边界

`page_invoice_tax_variances` 标准 pageName 入口现在固定显示税率差异页面；根据本轮 RISEMAP 实际筛选操作补齐“清空”和筛选无匹配文案。调整记录源保持逐字不变，未开始下一页精修。

当前仍为 `review_required`。replication 部分证明；visual pending；interaction 部分证明；business pending。像素一致、真实差异数据对照与独立复核未通过。

## 本轮实际打开的页面

- RISEMAP：`https://risemap.cn/finance/invoices/tax-variances`，已登录 Edge 独立标签。
- Forge：`http://localhost:4443/_console/apps/forge/page/page_invoice_tax_variances`，Edge 独立标签，SQLite `.objectstack/finance-reconciliation-parallel.sqlite`。
- 本轮使用 Edge 完成双侧操作；子线程当前无内置浏览器连接，因此项目要求的内置浏览器复验仍待主线补齐。

## 操作和观察

| 步骤 | RISEMAP 当前结果 | Forge 修复后结果 |
| --- | --- | --- |
| 直接打开页面，不加 nav | 标题“税率差异留痕” | 标题“税率差异留痕”；修复前错误显示调整记录 |
| 无筛选 | 共 0 条，“暂无税率差异留痕”，空态不展示表头 | 共 0 条，“暂无税率差异留痕”，空态不展示表头 |
| 方向选销项；来源填“对照-税率”；发票填“TEST-TAX” | 出现“清空”；空态变“未找到匹配的差异留痕” | 同样出现清空和无匹配文案 |
| 起止日期 2026-09-01 至 2026-09-20 | 日期输入接受范围，保持筛选空态 | 标准共享日历实际点击 9 月 1 日和 20 日，日历关闭，保持筛选空态 |
| 点击“清空” | 方向回全部；两个文本和日期清空；回初始空态 | 方向、来源、发票、日期均复位；清空按钮消失；回初始空态 |
| 完整停服后同库重启并刷新 | 不涉及修改 RISEMAP | 新源已载入，标准入口、筛选、清空和初始空态再次实际操作 |

RISEMAP 当前 0 条，DOM `th` 数量为 0。因此不能把 Forge 有数据时的 11 列宣称为本轮 RISEMAP 已验证列。Forge 既有列为方向、来源单号、发票号码、往来单位、约定税率、实际税率、预计税额、实际税额、税额差异、差异原因、差异时间；本次保留算法与列顺序，行为测试证明不被入口修复破坏。

## 可见残余差异

本轮双方截图均在会话中查看，尚未落盘形成同视口叠图证据。RISEMAP 使用带业务图片的约 106px 横幅，筛选和数量在紧凑的一行，空态卡约 220px 高。Forge 使用无图片渐变横幅，输入标签单独成行、计数放在底部，空态显著更高；中等宽度截图中日期控件超出列表卡右侧。这些属于未解决的视觉/响应式缺口，不能称精校完成。

RISEMAP 使用原生日期，Forge 保留共享日历，这是项目明确要求的控件承载差异。当前无真实税率差异材料，不能证明来源回溯、实际有数据列、跨页数据全量及业务计算等同。

## 验证

- `pnpm typecheck`：通过。
- `pnpm validate`：通过。
- `pnpm build`：通过（含页面静态门禁、211 导航入口检查）。全仓保留 184 条既有作者期警告；Node v25.6.1 与项目期望 24.19.x 有 engine warning。
- `node --test tests/finance-tax-variances-page-behavior.test.mjs`：5/5。覆盖无 nav 和冲突旧 nav 的入口、11 列与既有税额计算、全部筛选、清空与空态切换，以及调整记录模板未变。
- 使用 `kill -TERM` 停止专属 4443 进程，确认 HTTP 不可连接，再用同一个 SQLite 路径启动；浏览器刷新后完成上述操作。
- 重启后 API：`forge_sales_invoice_line` HTTP 200 / 0 条；`forge_purchase_invoice_line` HTTP 200 / 0 条。仅证明当前空数据对象回读，未写入业务单据，不能宣称真实差异账重启一致性通过。
- `git diff --check`：通过。

下一步仍是本页视觉/响应式精校、同视口截图、同材料税率差异明细和独立复核；保持待验收，不进入调整记录页。
