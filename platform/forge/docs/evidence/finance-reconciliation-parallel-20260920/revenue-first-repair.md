# 销售收入确认首个修复结果

## 状态

仅修改 `page_revenue_recognition`。当前仍 `review_required`，四维结果为 replication pending、visual pending、interaction 部分证明、business pending。尚不能进入下一页。

## 本轮差异与处理

| 编号 | 对照与缺陷 | 处理 | 已取得证据 |
| --- | --- | --- | --- |
| RR-01 | RISEMAP 本轮实时页面底部为每页 10 条；Forge 源码显示每页 10 条但实际渲染全部记录、固定第 1 页 | 每页实际切片 10 条；新增上一页/下一页、末页禁用与筛选后页码重置 | 构建后 React 页面行为测试使用 21 条记录，验证 10/10/1 和筛选收缩 |
| RR-02 | Forge 审核意见为空直接 return，确认按钮没有反馈 | 弹窗内显示“请填写审核意见后再提交。”；不发送请求；请求失败原因留在弹窗内 | 页面行为测试 0 次请求，弹窗仍打开且含 role=alert；这是 Forge 交互决策，RISEMAP 空数据尚未证明该规则 |
| RR-03 | 筛选后旧选择仍可能进入批量审核 | 筛选改变清空选择；提交再次约束为当前筛选范围内仍待审核的记录 | 页面行为测试选择 r0/r1 后筛选 r0，仅请求 r0 |
| RR-04 | 筛选栅格最小列宽总和超过窄屏；表头 CSS 存在 `font-weight:500font-size` 拼写 | 两列/单列断点和最小宽度约束；修复 CSS 分号 | 构建解析通过，实际窄屏截图和像素比较仍待补，不宣称视觉通过 |

标题、列顺序、15 列结构、现有业务 Action 和收入金额计算均保留。未扩展对象、财务状态机或修改共享文件。

## 当前实时页面与证据边界

- RISEMAP：主线本轮在已登录 Edge 读取 `https://risemap.cn/finance/revenue-recognition`；记录见 `docs/evidence/finance-parallel-20260920/live-comparison.md`。本子任务 Edge 连接持续失败，未独立办理。
- Forge：独立环境 `http://localhost:4443` 使用 `.objectstack/finance-reconciliation-parallel.sqlite`。修复前本子任务已在内置浏览器登录并观察财务税率差异入口错误（未在本批修复）。任务中断后内置浏览器连接消失，收入确认修复后页面尚未真实操作。
- 已成功读取收入确认 API，当前 0 条。这个结果只证明该隔离环境对象读取正常，不能证明正常业务链、审核、异常阻断或页面回读。
- 未写入业务单据；没有新增持久业务状态可做重启一致性验收。同材料业务办理和持久状态重启回读仍为待办，不能因此标为不适用。

## 工程检查

- `pnpm typecheck`：通过。
- `pnpm validate`：通过；全仓既有 React 解析/样式警告仍存在，未产生收入确认解析错误。
- `pnpm build`：通过，含页面静态门禁和 211 个导航入口检查；全仓 184 条作者期警告保留。
- `node --test tests/finance-revenue-page-behavior.test.mjs`：4/4 通过（分页、空意见反馈、批量范围、筛选重置）。测试执行构建后的页面源码与事件处理，使用内存数据，不能替代真实浏览器或业务 API 验收。
- `git diff --check`：通过。
- 本机执行 Node 为 v25.6.1；项目期望 Node 24.19.x，命令发出 engine warning。检查结果不等于目标 Node 环境已复验。

## 下一步

主线在恢复的浏览器中对独立分支收入确认页完成桌面/窄屏、筛选、21 条或以上测试材料分页、审核空意见阻断、正常审核与失败恢复。补齐同视口截图与差分、RISEMAP 同材料业务路径、API 与同库重启后，再安排独立复核；这些门禁未齐前不改 accepted、不推进税率差异页。
