# Forge 采购申请页面合同（2026-09-16）

## 页面职责与原型

- Forge：`page_purchase_request_pool`（`purchase-request.page.ts`）；RISEMAP 对应入口：`https://risemap.cn/purchase/requests`。
- 岗位：采购申请人与采购主管；主单据：采购申请（含物料明细）。
- 主原型：任务执行型，参考 `project-task-workspace.page.ts`。首屏顺序：标题与下一步入口 → 申请列表 / 物料明细页签 → 列表筛选 → 表格 → 分页；空态给出新建入口。
- 主动作：新建申请（工具栏最右主按钮）；次动作：批量导入、导出、刷新；下一步入口：采购待办池。

## 本轮事实与处理

### RISEMAP 已保存证据（非本轮实时）

- 来源：`docs/references/risemap-capture/deep/supply-chain/purchasing/rm-018/493-rm-018-purchase-request-list-pass1.txt`。
- 页面结构：面包屑“采购管理 / 采购申请”紧接标题“采购申请”、说明文案与“下一步操作 采购待办池”按钮；页签为申请列表、物料明细；工具栏为新建申请、导入/导出、刷新。
- 筛选：搜索框、状态下拉、一对日期输入并以 `~` 连接，右侧分页“共 0 条记录 每页 20 条”。
- 列顺序：申请编号、申请标题、优先级、关联项目、关联客户、负责人、物料数、总数量、预估含税金额、币种、期望到货日期、建议供应商、采购原因、备注、状态、申请日期、操作。Forge 现有列与顺序一致，未删列。
- 空态：RISEMAP 表格内显示“暂无采购申请”。

### 本轮 Forge 决策（页面质量标准，非 RISEMAP 业务事实）

- 已实现独立职责页面，不再由通用 `forge_administration_record` 页面承载。
- 已实现申请列表、物料明细、筛选、分页、导出、新建、编辑、查看、提交、同意、驳回、取消和采购待办入口。
- 已实现物料库选择、手动新增、快速粘贴；手工/粘贴明细不要求既有 SKU，但提交时必须具有名称、型号、物料分类、单位和正数量。
- “保存并提交审批”为真实连续动作：先持久化申请与明细，再执行提交 Action；审批通过生成具有申请与申请明细来源的采购待办。
- 附件存储尚未接入，因此页面只显示能力说明，不提供假上传按钮。
- Forge 使用 Console 标准对话框承载新建、编辑和审批；RISEMAP 当前为独立新建页。这属于平台统一页面语言差异，不改变字段和业务动作。
- 本轮按补充精修要求移除标题上方重复的“采购管理 / 采购申请”导航；下一岗位入口并入标题动作区。
- 列表筛选明确为“申请日期起（含）/止（含）”；搜索和状态均只作用于当前列表，不冒充全局范围。
- 桌面宽表为金额、币种和日期设置明确列宽，并固定状态与行操作；窄屏取消固定列，使用表内横向滚动，避免操作覆盖申请标题。

1. 删除页面自绘的“申 采购管理 / 采购申请”面包屑。Console 外壳与 `ForgePageHeader` 已经呈现同一路径，重复堆叠会挤占首屏；`ForgePageHeader` 保留为唯一标题区。
2. “下一步操作　采购待办池”按钮从独立条带移入标题右侧工具栏首位，位置与 RISEMAP 一致，删除条带后不丢失该入口。
3. 两个日期输入合并为一个“申请日期”范围控件，中间以 `~` 标明起止，无障碍标签为“申请开始日期 / 申请结束日期”；清空筛选同时重置起止。
4. `pr-table` 宽表（min-width 1540px）下把申请编号列固定在左侧、操作列固定在右侧并加分隔阴影，状态与行操作在横向滚动时始终可见；申请标题、采购原因、备注列限定宽度并允许换行，避免单行被撑到不可读。

## 未决与证据边界

- 本轮没有实时打开 RISEMAP 当前页面，也没有完成 Forge 桌面 / 窄屏浏览与控件实操，因此复刻一致性、结构视觉、交互完整性、业务正确性四项均未判定通过，页面保持 `review_required`。
- 未经页面验证：申请 → 审批 → 待办 → 询价/订单承接的推进已在 API 层跑通（见下节），但未在同一浏览器会话里逐控件办理；附件能力（页面已标明“附件存储尚未接入”）与导入 / 导出的真实文件回读仍未验证。
- 静态职责与精修断言：`apps/forge-objectstack/tests/purchase-request-dedicated-page.static.mjs`。
- 验收记录：`apps/forge-objectstack/tests/page-acceptance/page_purchase_request_pool.json`。

## 同批页面与 API 验收（2026-09-16）

- 本批覆盖采购申请、采购待办池、询价管理、采购订单四页。
- 采购待办池改动：删除页面自绘的“采 采购管理 / 采购待办池”面包屑，把旧 `fp-page-header` / `fp-header-actions` 标题区改为共享 `ForgePageHeader`，并把“下一步操作　询价管理”移入标题右侧工具栏首位。属 Forge 页面质量标准整改，非 RISEMAP 业务事实。
- 询价管理页面本轮未改动，仅登记验收状态。
- 采购订单页改动：删除页面自绘的“04 供应链 / 采购管理 / 采购订单”面包屑与复制的标题区，改用共享 `ForgePageHeader` 并保留原五个工具栏动作（新建采购单、导出、付款申请、收票登记、刷新）；2180px 宽表把订单号列固定在左、操作列固定在右。同样属 Forge 页面质量标准整改。
- 独立端口 `http://localhost:4496`、数据库 `file:.objectstack/production-placeholders-batch1.sqlite` 上的 API 结果：`purchase-request-entry-modes` passed（手工明细 + 快速粘贴 + 审批阻断）、`purchase-todo-pool` 3/3 PASS、`purchase-inquiry` 4/4 PASS、`procurement-chain` 7/7 PASS。
- 停服重建后同库重启回读：`purchase-request-entry-modes-restart-readback` passed（申请、两条明细、两条待办 ID 一致）、`purchase-inquiry-restart-readback` PASS、`procurement-restart-readback` PASS。
- 完整记录：`apps/forge-objectstack/tests/page-acceptance/procurement-chain-api-readback-20260916.json`。
- 仍缺：同一组材料在 RISEMAP 与 Forge 两侧的页面办理对照，以及三页的控件实操、桌面 / 窄屏截图与控制台扫描。缺口未闭合前不宣称页面已复刻或精修通过。

## 验收材料

- API：`tests/purchase-request-entry-modes.integration.mjs`
- 重启回读：`tests/purchase-request-entry-modes-restart-readback.mjs`
- 页面结构：`tests/purchase-request-dedicated-page.static.mjs`
- 工程门禁：`pnpm typecheck`、`pnpm validate`、`pnpm build`
- 浏览器：RISEMAP `/purchase/requests`、`/purchase/requests/new` 与 Forge `page_purchase_request_pool` 的操作前、表单阻断、提交反馈、审批结果和重启后回读。

## 逐项交付映射

| 要求编号 | 当前事实或 Forge 决策 | 实现位置 | 操作步骤与实际结果 | 状态/缺口 |
| --- | --- | --- | --- | --- |
| PR-001 | RISEMAP 单一标题与业务面包屑 | `purchase-request.page.ts` 标题区 | 桌面与窄屏均只保留一套业务标题；下一步按钮仍可达 | pass |
| PR-002 | RISEMAP 以申请日期范围筛选 | 列表筛选区 | 起止标签明确为含边界；筛选只更新当前申请/明细列表 | pass |
| PR-003 | RISEMAP 长表包含完整字段 | 列表宽表 CSS 与列定义 | 1440×900 金额、币种、日期可读，状态/操作固定；390×844 无列覆盖 | pass |
| PR-004 | 提交进入统一审批中心 | `purchase_request_submit` 与“前往我的审批” | 页面提交、审批、状态回读和待办来源已办理 | pass |
| PR-005 | RISEMAP 同材料提交与取消反馈 | 两侧当前数据 | RISEMAP 列表为空，本轮未写入线上租户 | blocked：待同材料复核 |

四维状态：replication `blocked`；visual `pass`（实施者桌面/窄屏检查）；interaction `pass`（本批关键控件）；business `pass`（Forge 正常与异常路径）。独立复核未发生，页面仍为 `review_required`。

上述逐项映射由供应链接口一致性批次记录，采购申请页面在合并时采用了主线版本，页面视觉与交互需要在合并后版本上重新核对。
