# 销售发货单页面合同（RISEMAP 结构验收）

记录日期：2026-09-13  
本轮范围：销售业务下的销售发货单入口。  
对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。  
最终验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 本轮实际打开的页面

- RISEMAP：`https://risemap.cn/sales/outbound`
- RISEMAP：`https://risemap.cn/sales/outbound/new`
- Forge 改造前对象表：`http://localhost:4321/_console/apps/forge/forge_sales_shipment`
- Forge 改造后业务工作区：`http://localhost:4321/_console/apps/forge/page/page_sales_shipment_workspace`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-shipment/`

## RISEMAP 当前事实

销售发货单位于销售业务菜单，入口名称为“销售发货单”。页面面包屑为“销售业务 / 销售发货单”，页面标题为“销售发货单”，页面说明为“发货出库登记、物流跟踪、签收回执与开票联动”。首屏动作包含“下一步操作 待出库发货单”“新建发货单”“导出”“导出任务”“刷新”和图标操作按钮；下一步入口说明为“前往出库管理 · 待出库发货单”。

筛选区包含搜索、状态和范围。列表列为：发货单号、关联订单、客户单号、客户名称、收货人、状态、出库进度、含税金额、出库单、出库日期、操作。

当前样例行：`DN-2026-0001`，关联订单 `SO-2026-0001`，客户单号 `-`，客户“苏州澄岳自动化装备有限公司”，收货人“周启明”，状态“待发货”，出库进度 `0 / 1 台`，含税金额 `¥128,000.00`，出库单 `0`，出库日期 `2026-09-09 00:00:00`，操作包含图标按钮和“删除”。

新建发货单页面标题为“新建发货单”，动作包含“取消”“确认创建”。表单分区包含“基本信息”“收货信息”“商品明细”“备注”“附件”和“操作提示”。基本字段包含发货单号、客户、发货日期、关联销售订单；关联订单提示为“可勾选多个订单合并发货”，并要求先选择客户再从该客户的销售订单列表勾选。收货信息包含收货人、联系电话、收货地址。商品明细提示先选择客户和订单，明细会自动带出并按物料合并。操作提示说明支持选择一个或多个销售订单合并发货、本次发货数量不可超过未发货数量、支持部分发货、后续创建出库单时可分批出库。

## Forge 改造前表现

销售发货单入口此前指向通用对象表 `forge_sales_shipment`。页面能展示对象数据，但列为发货单号、发货单名称、客户、发货日期、发货数量、已出库数量、发货含税金额、发货单状态、操作，缺少 RISEMAP 当前页的关联订单、客户单号、收货人、出库进度、出库单、出库日期和下一步待出库入口，也没有面向业务办理的新建/确认发货弹窗。

## Forge 本轮落地

- 销售业务菜单中的“销售发货单”改为业务工作区 `page_sales_shipment_workspace`。
- 首屏标题、说明、下一步入口、指标卡、搜索、状态筛选、范围、清空筛选和列表结构按 RISEMAP 当前页重排。
- 列表展示发货单号、关联订单、客户单号、客户名称、收货人、状态、出库进度、含税金额、出库单、出库日期、负责人和操作。
- “新建发货单”使用 ObjectStack Console 共享弹窗，第一步填写客户订单、发货日期、数量和收货信息，第二步显示确认创建影响；提交后调用现有销售订单创建发货单动作。
- “确认发货”使用共享弹窗，第一步填写出库单号、仓库、日期、数量、客户自取和备注，第二步显示仓库、数量和库存扣减影响；提交后调用现有销售发货单创建出库单动作。
- “下一步操作 待出库发货单”指向 Forge 当前出库对象入口，承接出库处理。后续如建立专门的待出库发货单页面，再替换为专页入口。
- 删除、撤销、作废等破坏性动作没有在本业务工作区直接暴露；需要保留时必须使用标准二次确认弹窗，显示操作对象、业务影响和不可恢复结果。这是 Forge 产品安全决策。

## 明确差异与处理结论

- RISEMAP 当前新建页支持先选客户后勾选多个销售订单合并发货，并支持附件上传。Forge 本轮先承接现有可写动作，支持从一个执行中订单创建发货单；多订单合并、附件上传和客户选择后的订单勾选留作后续销售发货增强。
- RISEMAP 当前页说明包含物流跟踪、签收回执与开票联动。Forge 本轮完成发货建单、库存校验、出库扣减、来源回写和下一步出库承接；物流跟踪、签收回执和开票联动页面仍是后续销售域缺口。
- RISEMAP 当前列表有删除动作；Forge 当前工作区不直接暴露删除，以避免跳过二次确认。若后续增加删除，必须先按 Forge 二次确认标准补齐弹窗和阻断规则。
- Forge 显示 `Dev Admin`，RISEMAP 显示 `金一涛`。按用户决策，两者为同一业务用户，不记录为功能缺口。

## 验收记录

### 内置浏览器

- RISEMAP 销售发货单列表：`risemap-sales-shipment.ax.txt`、`risemap-sales-shipment.png`。
- RISEMAP 新建发货单页面：`risemap-sales-shipment-new-dialog.ax.txt`、`risemap-sales-shipment-new-dialog.png`。
- RISEMAP 收尾复核列表：`risemap-sales-shipment-final.ax.txt`、`risemap-sales-shipment-final.png`。
- Forge 改造前对象表：`forge-sales-shipment-before.ax.txt`、`forge-sales-shipment-before.png`。
- Forge 业务工作区：`forge-sales-shipment-workspace.ax.txt`、`forge-sales-shipment-workspace.png`。
- Forge 新建发货单弹窗第一步和第二步：`forge-sales-shipment-new-dialog-step1.ax.txt`、`forge-sales-shipment-new-dialog-step1.png`、`forge-sales-shipment-new-dialog-step2.ax.txt`、`forge-sales-shipment-new-dialog-step2.png`。
- Forge 确认发货弹窗第一步和第二步：`forge-sales-shipment-outbound-dialog-step1.ax.txt`、`forge-sales-shipment-outbound-dialog-step1.png`、`forge-sales-shipment-outbound-dialog-step2.ax.txt`、`forge-sales-shipment-outbound-dialog-step2.png`。
- Forge 最终干净库、停服重启后页面：`forge-sales-shipment-workspace-final.ax.txt`、`forge-sales-shipment-workspace-final.png`。

最终 Forge 页面显示 `DN-CONVERT-20260909-001`、关联订单 `SO-CONVERT-20260909-001`、客户“苏州澄岳自动化装备有限公司”、收货人“周启明”、状态“已出库”、出库进度 `1 / 1 台`、出库单 `OUT-CONVERT-20260909-001`、负责人 `Dev Admin`。

### API、库存与持久化

使用最终干净 SQLite：`/tmp/forge-sales-shipment-final.sqlite`。服务端口：`4321`。

按空库顺序通过：

- `scripts/seed-reference-data.mjs`
- `acceptance:sales`
- `acceptance:sales-workflow`
- `acceptance:sales-conversion`
- `acceptance:sales-shipment`
- `acceptance:inventory`
- `acceptance:sales-outbound`

完整停服后从同一 SQLite 文件重启，通过：

- `acceptance:sales-restart`

工程门禁通过：

- `pnpm --dir apps/forge-objectstack typecheck`
- `pnpm --dir apps/forge-objectstack validate`
- `pnpm --dir apps/forge-objectstack build`
- `git diff --check`

`validate` 与 `build` 仍保留既有 `react-source` 页面 `className` 风格提醒；本轮新页沿用当前 Forge 产品页共享 CSS 方案，构建通过。

## 当前状态

销售发货单入口已经从通用对象表推进为可对照的业务工作区。本轮完成了 RISEMAP 当前列表和新建页取证、Forge 页面结构收敛、发货建单与确认发货二次确认、库存扣减和来源回写、内置浏览器页面证据、API 验收、同一 SQLite 停服重启回读以及工程门禁。

销售发货单本轮可验收范围是：从已生效订单创建发货单、展示来源订单和客户收货信息、按库存创建出库单、回写发货和订单进度。多订单合并发货、附件上传、物流跟踪、签收回执、开票联动和专门的待出库发货单页面仍是后续销售域缺口。

## 2026-09-14 控件布局与真实办理复查

本轮重新打开 RISEMAP 当前销售发货单页面和 Forge 当前销售发货单页面做实时对照。RISEMAP 新建发货单从列表主按钮进入独立新建页，页面顺序为基本信息、商品明细、备注、附件和操作提示；用户先选择客户，再从该客户销售订单列表中选择来源订单，商品明细随后带出。该顺序符合发货业务人员的自然办理路径。

Forge 原页面的“新建发货单”可以提交，但从客户订单开始，缺少客户先行、订单随客户过滤和商品明细预览，默认发货单号也容易在连续办理中重复。本轮已修正为：主按钮仍放在列表页右上方；弹窗内部按基本信息、收货信息、商品明细、备注、附件和操作提示组织；客户选择提前，关联销售订单按客户过滤；商品明细展示物料编码、名称、订单数量、已建发货和本次发货；附件入口当前以说明文本呈现，不做成不可用上传按钮；发货单号和出库单号改为带时间戳，连续办理不会默认重复。

内置浏览器已验证 Forge 页面真实可办：点击新建发货单进入表单，点击下一步进入确认创建，确认提交后列表新增 `DN-FORGE-20260913173455`；点击该单的确认发货进入出库表单，再进入确认出库。库存不足时页面明确阻断“可用库存不足，无法创建出库单”；补足当前库同物料库存后再次确认，页面提示“销售出库单已创建”，刷新后回读为 `已出库`、进度 `2 / 2 台`、出库单 `OUT-FORGE-20260913173516`。这证明该页面的主按钮、确认弹窗、异常阻断、成功反馈和状态回读均真实可用。

证据保存于 `docs/references/risemap-capture/live/20260914-sales-shipment-usability/`。本轮仍不把多订单合并发货写成已完成能力；Forge 当前以业务说明告知单订单办理方式，避免把未实现能力伪装成可点击控件。

## 2026-09-20 逐页高标准复核

### RISEMAP 当前事实变化

实时打开 `https://risemap.cn/sales/outbound` 后，当前列表不再为空，显示两条待发货单：`DN-2026-0002`（来源 `GW-2026-0001`，出库进度 `0/2 台`，金额 `¥0.00`）和 `DN-2026-0001`（来源 `SO-2026-0001`，出库进度 `0/1 台`，金额 `¥128,000.00`）。当前页面仍为蓝色标题区、下一步“待出库发货单”、新建/导出/导出任务、刷新与列表设置、搜索/状态/范围、带复选框的 11 列列表。旧合同中的 RISEMAP 空态事实已过期，以本节实时事实为准。

### 本轮实现与控件证据

- 修复 Forge 工作区未携带当前 Bearer 会话导致的 `UNAUTHENTICATED`；当前成功读取 9 条本地发货单。
- 删除 RISEMAP 当前页面不存在的四张指标卡和顶部“发货台账”动作，把标题区、操作条、筛选条和列表按线上顺序重排。
- “范围”从无业务结果的按钮改为真实选择器，可切换“全部范围 / 我负责的”；增加真实 CSV 导出、导出任务说明、行选择/全选和已选数量回读。
- 实际勾选一条发货单，底部分页回读“已选择 1 条”；实际打开导出任务说明；搜索 `DN-FORGE-20260913173455` 后 9 条缩为 1 条。
- 实际打开“新建发货单”，表单带出客户、可发订单、商品明细和剩余 `0.4` 台。由于收货地址为空，点击“下一步”仍停留在表单并显示完整必填阻断；本轮没有提交新单。
- 新建和出库动作现在都在进入二次确认前先完成必填与正数校验，避免无效表单先进入确认页。

### 当前状态与剩余门禁

页面继续保持 `review_required`。RISEMAP 当前两条单据与 Forge 九条历史单据并非同一材料；多订单合并、附件、物流跟踪、签收和开票联动仍未完成；还缺本轮同宽截图差分、窄屏、同一 SQLite 停服重启回读及独立复核。因此本节只证明列表结构、当前本地数据读取和已点击控件，不把整页或端到端发货链写成验收通过。

### 2026-09-20 几何压力缺陷返修

用户复核指出真实长单号下存在控件和文本互相挤压。内置浏览器截图确认：发货单号和来源名称被压成多行，行高异常拉大；横向滚动到右侧后，长出库单号越过列边界并与出库日期重叠。该问题此前未被可访问性树和控件点击检查发现。

本轮将共享按钮、图标按钮和筛选控件补充抗收缩约束；销售发货表格改为明确列宽与卡片内横向滚动；长发货单号、来源名称、关联订单和出库单号使用单行省略并保留完整值提示；单元格增加溢出裁剪。随后在 `1280×900` 桌面和 `760×900` 窄屏分别检查，并实际横向滚动到右侧操作列，确认表格行保持稳定高度、出库单号与日期不再重叠、查看按钮可达。该返修解决几何挤压问题，但不改变上一节列出的同材料、像素差异、重启和独立复核缺口，页面仍为 `review_required`。
