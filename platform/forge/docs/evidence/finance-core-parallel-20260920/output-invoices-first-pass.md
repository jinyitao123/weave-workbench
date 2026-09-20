# 销项发票首轮修复记录

日期：2026-09-20。范围仅 `page_output_invoices`；仍为 `review_required`。

## 已观察与本轮修改

主任务实时打开 RISEMAP `/finance/invoices/sales`（Edge）和 Forge 主线 `page_output_invoices`（内置浏览器），记录位于主线 `docs/evidence/finance-parallel-20260920/live-comparison.md`。RISEMAP 当前是空态，期间和导出在同一行；Forge 原来将导出、独立期间卡、重复列表标题分成额外行。

本轮仅将期间和导出置于同一右对齐行，移除独立期间卡和重复列表标题。期间日期仍通过期间组 title 提示保留，记录数量仍位于表格底部。刷新、搜索、重置、查看与红冲继续保留。未改任何账务口径、接口或状态迁移逻辑。

实际打开的页面：实施子任务内置浏览器先打开 RISEMAP 销项入口，但重定向到登录；独立 Forge 4441 进项发票首屏已打开。用户随后要求逐页处理，子任务未对进项源码实施修改。中断后该子任务 IAB 不再可用，销项修改后页面交由主任务的 IAB 复核。

## 验证

- `pnpm typecheck`：通过。
- `pnpm validate`：通过，已有其他页面 JSX 解析警告与 source className 提示保留；不将警告隐藏或改为全局无告警。
- `pnpm build`：通过（184 author-time warnings）；prebuild 页面静态门禁与 postbuild 211 个导航入口检查通过。
- 运行环境：`http://localhost:4441`，独立 SQLite `apps/forge-objectstack/.objectstack/finance-core-parallel.sqlite`。没有借用主线端口证明分支通过。
- 本轮纯布局修改，没有新增账务测试材料或持久业务写入；没有执行停服重启业务回读，也不引用历史回读冒充本轮结果。

## 四维状态与残项

| 维度 | 状态 | 证据边界 |
| --- | --- | --- |
| replication | pending | 本轮已依据实时结构事实修复；RISEMAP 无有数据行交互证据，且当前 RISEMAP 取证在 Edge |
| visual | pending | 仍待修改后同视口桌面/窄屏截图；横幅 150px vs 约106px、图片、精确字号/颜色/间距和像素差分未消除 |
| interaction | pending | 修改保留既有 handlers，仍需真实点击期间/导出/搜索/重置及行级动作复核 |
| business | pending | 未改变业务逻辑；同材料双侧业务链、API/页面一致与重启仍待本页完整验收 |

下一页 `page_input_invoices` 不开始实现，直到销项发票本页门禁满足或主任务按最新用户指令明确调整。当前提交只是可审查的首个修复，不能标记 accepted。
