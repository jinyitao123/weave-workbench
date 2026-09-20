# 银行余额对账单页首轮结果（部分证明）

日期：2026-09-20。本轮只修改 `page_bank_statement`。起始版本 `c835cf2d4b81b4286dd29814ec823d9ac811f71c`；分支 `codex/finance-banking-parallel`。不修改共享控件、对象、Action、导航或验收manifest，不进入期初往来账。

## 当前证据和修复

主线本轮实际打开 Forge `http://localhost:4442/_console/apps/forge/page/page_bank_statement`，确认暂存银行CSV表单、11列导入批次表、9列余额对账表，两个列表均无记录。RISEMAP当前专页未获得，分线两次浏览器连接失败，后续主线也因同一浏览器策略读取错误停止重试。因此以下都是有现有Action依据的Forge交互修复，不是RISEMAP像素复刻通过。

- 取消和撤回使用标准 `ForgeDialog`，标出所选批次、账户、操作影响及不可恢复结果，必须填写原因才提交。
- 生成流水、确认余额、记录差异也在各自当前对象弹窗中填写说明，解除行操作对顶部CSV表单说明的隐性依赖。
- API失败在当前弹窗显示原因并保留输入；同步锁阻止重复提交；成功回读真实列表后反馈。提交已成功但回读失败时明确提示需刷新核对，不宣称列表已更新。
- 导入批次和余额对账的空表保留列头，并分别说明如何产生数据。
- 修正表头CSS分隔错误，约束本页表单和共享选择器宽度。
- 顶部说明改为“导入说明”，与Action可选 `remarks` 契约一致；行操作原因单独必填。

## 验证结果

| 验证 | 结果 | 证据边界 |
| --- | --- | --- |
| `pnpm typecheck` | pass | Node25与项目Node24要求存在既有engine警告 |
| `pnpm validate` | pass | 保留全仓既有author-time警告；本页没有新增源解析错误 |
| `pnpm build` | pass | 含页面静态检查和211项导航检查 |
| `node --test tests/finance-bank-statement-page.test.mjs` | 4/4 pass | 执行实际编译页面源：空态/列头、打开危险操作不写入、空原因阻断、取消弹窗、后端拒绝保留对象与原因、成功刷新关闭、并发只提交一次 |
| API测试材料 | pass | 三笔可识别批次分别待生成、已生成、余额已确认；两份对账；同一测试账户账面100保持不变 |
| 完整停服重启 | pass | SIGINT停服并确认4442无监听；同一SQLite重新启动后回读三批次和两对账，账户100与状态一致 |
| 修改后浏览器独立操作 | blocked | 主线与分线浏览器均遇策略读取错误；不把行为测试替代页面点击、截图或像素对照 |

隔离材料：`BS-PAGE-20260920-CANCEL` 为 `staged`；`BS-PAGE-20260920-REVERSE` 为 `posted`，对账为 `balanced`；`BS-PAGE-20260920-BLOCKED` 为 `posted`，对账为 `confirmed`，用于下一轮验证撤回阻断。未实际从浏览器执行取消/撤回，这三笔材料保留以供页面复核。所有数据仅在本地隔离 `.objectstack/finance-banking-parallel.sqlite`，未提交数据库或登录态。

复现命令（`apps/forge-objectstack`）：

```sh
FORGE_URL=http://localhost:4442 node tests/finance-bank-statement-page-fixture.mjs
node --test tests/finance-bank-statement-page.test.mjs
# 同一 SQLite 完整停服重启后
FORGE_URL=http://localhost:4442 node tests/finance-bank-statement-page-fixture.mjs --readback
```

## 四维结论

- replication：`pending`；缺RISEMAP当前专页、同材料业务路径。
- visual：`pending`；缺修改后桌面/窄屏截图与同视口像素差异。
- interaction：`pending`；编译页面行为4/4通过，修改后真实按钮操作、焦点/键盘、提交后页面状态待浏览器复核。
- business：`pending`；API材料和停服重启回读通过，双侧业务验收未发生。
- 页面继续 `review_required`，未进入下一页。

使用 `objectstack-ui`、`objectstack-query`、`objectstack-platform` Skill；实际改动为单页交互与反馈、专属行为测试和本地测试材料脚本。独立业务复核未发生，不能由实施者自行签署通过。
