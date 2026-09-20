# 资金流水单页首轮修复结果（部分证明）

日期：2026-09-20。起始版本 `cf56502c4e7ceac1b01a77b4aa9f9cbe39149b7a`；分支 `codex/finance-banking-parallel`。仅修改 `page_bank_flow`，其余银行与资金页面未修改，所有页面设计状态保持 `review_required`。

## 实际对照与改动

主线本轮实际打开 RISEMAP `/finance/bank-flow`，四项指标、五状态页签、搜索和四筛选、12项业务列及20条分页/底部合计已实时核对；完整当前事实在主线 `docs/evidence/finance-parallel-20260920/live-comparison.md`。银行分线实际打开 IAB 的 Forge `http://localhost:4442/_console/apps/forge/page/page_bank_flow`，检查 1280×720 首屏，发现筛选互相挤压及静态分页。

- 限定本页筛选网格与共享 picker 宽度，1050px 以下改为两列，680px 以下一列；页面入口、页签和分页允许换行。
- 资金明细使用20条切片，提供上一页/下一页、实际页数和首末页禁用状态；筛选变化重置为第一页，数据减少后显示有效页。
- 增加筛选结果全体收入、支出、已分配和待分配合计；翻页不改变统计口径，导出保持筛选结果全体。
- 发起勾兑失败保留选中流水、账面收付款及输入；成功回读后才清空选择；同一操作未结束时拒绝重复提交。
- 有筛选但无匹配结果时明确提示调整条件；报错区域提供 `role="alert"`。

## 验证

| 项目 | 结果 | 范围与限制 |
| --- | --- | --- |
| `pnpm typecheck` | pass | 存在当前 Node 25.6.1 与项目要求 Node 24 的 engine 警告 |
| `pnpm validate` | pass | 保留全仓既有 author-time 警告；本页无新增解析错误 |
| `pnpm build` | pass | 页面静态门禁与211项导航检查通过 |
| `node --test tests/finance-banking-page.test.mjs` | 3/3 pass | 针对实际编译后页面源的25条20+5分页、汇总、末页禁用、数据缩量钳制、勾兑失败保持输入、成功清理与重复提交阻断；不替代浏览器 |
| 隔离 API 材料 | pass | 账户 `BF-PAGE-20260920`、25条 `BF-PAGE-20260920-01` 至 `-25`，收入1690、支出1560、全部未勾兑 |
| 同库完整停服重启 | pass | SIGINT停止服务，确认4442无监听，再从同一 `.objectstack/finance-banking-parallel.sqlite` 启动；25条、金额与未勾兑状态回读一致 |
| 修改后浏览器分页 | pass（独立复核） | 主线刷新4442后读取 `main table tbody tr`=20；点击“资金流水下一页”后=5；显示“每页20条 · 第2/2页” |

初次主线回读发现4442仍运行旧编译产物，显示25条且静态第1页。原因是中断后开发服务加载旧 artifact，单独 build 不重载现有服务。已完整停服后加载新产物，主线再次刷新后独立确认20+5分页通过。分线回合中断后IAB不可用，Edge策略读取失败，因此其余修改后控件/截图仍待补证。

复现命令（在 `apps/forge-objectstack`）：

```sh
FORGE_URL=http://localhost:4442 node tests/finance-banking-page-fixture.mjs
node --test tests/finance-banking-page.test.mjs
# 同库停服重启后只读验证
FORGE_URL=http://localhost:4442 node tests/finance-banking-page-fixture.mjs --readback
```

## 四维结论与残余缺口

- replication：`pending`。RISEMAP 当前空数据；行级动作、修改类型、批量审核及两侧同材料业务结果未核对。
- visual：`pending`。已修控件宽度约束；缺修改后桌面/窄屏截图、同视口叠图与像素差异分析。
- interaction：`pending`。页面源行为测试与主线独立浏览器20+5翻页通过；筛选复位、真实失败反馈和行级业务仍待浏览器复核。
- business：`pending`。测试流水分页材料与同库重启回读已证明；没有将夹具、银行侧证据或当前状态称为真实资金账闭环。
- 现有数据读取上限为200条，本轮不宣称超过200条全量业务数据可分页查阅；此项作为后续查询完整性缺口保留。
- 未进入下一页。主线已独立复核分页；整页最终通过状态未签署。

实际使用 `objectstack-ui`、`objectstack-query` 与 `objectstack-platform`（隔离运行和门禁）Skill。测试数据和本地SQLite保留在隔离工作树，未提交数据库、登录态或构建产物。
