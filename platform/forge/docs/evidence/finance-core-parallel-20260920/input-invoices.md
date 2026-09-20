# 进项发票单页修复与验证

- 日期：2026-09-20；起始版本：`83dd2f892ff03527fffdb03e5da4af71e449e0e9`。
- 本批仅处理 `page_input_invoices`，不修改销项、任务或其他财务页分支。
- 实施环境：`http://localhost:4441/_console/apps/forge/page/page_input_invoices`。
- SQLite：`apps/forge-objectstack/.objectstack/finance-core-parallel.sqlite`。
- 主原型：`task_workspace`，财务人员查看供应商来票并登记抵扣结果；参考 `project-task-workspace.page.ts` 的标准办理反馈。
- 使用 Skill：objectstack-ui、objectstack-query，复用现有 ForgeDialog、ForgeStatus、ForgeNotice；没有修改对象、Action 或共享组件。

## 事实与范围

RISEMAP 入口：`https://risemap.cn/finance/invoices/purchase`。本日已保存的实时事实见主任务 `docs/evidence/finance-parallel-20260920/live-comparison.md`：标题和说明、期间、邮件收票/导出、四 KPI、状态、搜索、类型/抵扣选择、列与空态已读取；当前没有可办理的发票数据，认证抵扣等行级行为未观察。

本子任务首次使用内置浏览器打开了独立 Forge 进项页，确认为空态，看到首屏、期间、状态、类型与抵扣筛选、表头。重新开始本页时子任务 IAB 已不在浏览器清单；Edge 新建页面两次均因连接策略失败。主任务明确要求停止重试，使用已保存实时事实继续修复 Forge 自身已知缺陷。此来源和缺口不改写为新一轮 RISEMAP 实时双侧验收。

### 当前已知缺陷及处理

| 要求 | 旧表现 | 修复/验证对象 |
| --- | --- | --- |
| INPUT-001 发票号码 | 表头发票号码却显示内部登记 `code` | 使用 `invoice_number`；缺失显示 —，不将登记号冒充发票号码 |
| INPUT-002 抵扣状态 | 直接显示 pending/certified 等存储值 | 使用共享状态组件与待认证/已认证抵扣/不抵扣中文映射 |
| INPUT-003 可用动作 | 本页判断 `approved`，实际正常发票是 `normal`；setWorkflow 后未渲染弹窗 | 复用现有行级状态判断，仅正常且待认证展示认证/不抵扣；补标准弹窗、取消、忙碌、上下文错误和成功后重新加载 |
| INPUT-004 抵扣说明 | 公共函数将认证和不抵扣都错误地要求原因 | 本页独立处理认证说明可选、不抵扣原因必填，与现有 Action 契约一致 |
| INPUT-005 业务反馈 | 专属分支未显示 toast、无弹窗错误 | 本页渲染 ForgeNotice 与 ForgeDialog；零税率仍由 API 阻断 |

此批按主任务要求优先修复上述可用性与语义问题。四项指标口径、期间布局、勾选列、邮件收票实际能力、精准横幅与像素细节均没有因此自动通过；这些保留为同页下一轮精校范围，不以本次缺陷修复冒充整页完成。

## 本地测试材料

`tests/finance-input-page.integration.mjs --setup` 通过现有采购订单审批 → 到货登记 → 当前免检自动入库 → 登记进项发票创建以下三张材料；登记号为 REG-INPUT 前缀，发票号码为 TEST-INPUT 前缀，用于实际区分字段。

| 用途 | 发票号码 | 记录 id | 税率 |
| --- | --- | --- | --- |
| 页面认证 | TEST-INPUT-1789868790891-certify | yhQX2bdBWW9iAfOD | 13% |
| 页面不抵扣 | TEST-INPUT-1789868790891-exclude | upCnNUs0b1cC55uR | 13% |
| 页面异常 | TEST-INPUT-1789868790891-zero | 1u39egKj2j4uIBEa | 0% |

这些只存在于独立 Forge 测试库，没有写入 RISEMAP，也不代表真实财税办理或同材料闭环。材料保留供复核，数据库、登录态和运行输出不提交。

旧 `procurement-chain.integration.mjs` 通过，但 `procurement-receipt-inbound.integration.mjs` 假设默认必检，其预期 pending_inspection 与当前实际 exempt_stocked 不符，后续检验断言也失败。因此没有沿用旧采购脚本 PASS；转用当前免检路径的专属准备脚本。第一次专属准备还命中四位小数校验，已改为显式四位舍入；留下一个对照前缀草稿用于失败追溯。

## 验证记录

- `pnpm typecheck`、`pnpm validate`、`pnpm build`：通过。184 条既有 author-time warnings（包含其他页面 JSX/自定义 className 提示）保留。
- 主任务复核通道同样遇到浏览器连接策略错误并停止重试。因此本轮未点击修改后的进项页面，取消、提交中、弹窗可见性、筛选、导出、下一步与窄屏仍待真实浏览器验证；以下全部为 API 证据，不标成浏览器操作。
- `FORGE_URL=http://localhost:4441 node tests/finance-input-page.integration.mjs --exercise-api`：通过。认证说明留空成功，认证状态、操作人、时间和默认说明回读；不抵扣空原因返回 400（Action 参数必填校验），状态仍 pending；补原因后为 not_deductible；零税率认证返回 400 且仍 pending；已办理记录重复认证返回 400；匿名调用返回 401。
- 完整停止独立 watcher PID 20497 与服务 PID 23289，确认 4441 无监听，再从同一 `file:.objectstack/finance-core-parallel.sqlite` 启动服务（新服务 PID 23976）。重启后执行 `FORGE_URL=http://localhost:4441 node tests/finance-input-page.integration.mjs` 通过，三张发票仍分别为 certified/not_deductible/pending，原发票号码、税率、操作留痕一致。
- 专属测试只证明独立 Forge 的动作与持久性，不能替代 RISEMAP/Forge 同材料页面路径。脚本准备和回读输出存放在忽略的 `.objectstack/acceptance/finance-input-page.json`；其中不含密码、token 或 cookie。
- 四维状态：replication pending；visual pending；interaction pending；business pending。总体 `review_required`，不修改 manifest 为 accepted。
