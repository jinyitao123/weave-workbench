# 框架销售合同与销售订单页面合同（RISEMAP 结构验收）

记录日期：2026-09-13  
本轮范围：销售业务下的框架销售合同、销售订单两个入口。  
对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。

## 本轮实际打开的页面

- RISEMAP：`https://risemap.cn/sales/contracts`
- RISEMAP：`https://risemap.cn/sales/orders`
- Forge：`http://localhost:4321/_console/apps/forge/page/page_sales_contract_workspace`
- Forge：`http://localhost:4321/_console/apps/forge/page/page_sales_order_workspace`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales/`

## RISEMAP 当前事实

### 框架销售合同

入口位于销售业务，页面名称为“框架销售合同”，页面说明为“客户合同签订、条款管理、收款跟进与执行情况追踪”。首屏动作包含“新建合同”“导入/导出”“刷新”。筛选区包含搜索、范围、状态、订单状态、开票、发货、收款、负责人、客户联系人，并按创建时间降序展示。

列表列为：合同编号、客户单号、合同名称、合同类型、客户名称、关联项目、来源、合同总额、开票、已发货、已回款、状态、订单状态、下单笔数、已下单金额、红绿灯、签订日期、备注、创建时间、更新时间、开单人、负责人、联系人、操作。

当前样例行：`SC-OEM-20260909-001`，合同名称“苏州澄岳自动化装备有限公司 - OEM设备框架销售合同”，合同类型“设备销售框架合同”，客户“苏州澄岳自动化装备有限公司”，来源 `QT-OEM-20260909-001`，合同总额 `¥243,200`，状态“执行中”，订单状态“已下单 1 笔 / ¥243,200”，签订日期 `2026-09-09`，开单人和负责人均为金一涛。

### 销售订单

入口位于销售业务，页面名称为“销售订单”，页面说明为“客户订单录入、确认、备货发货、收款进度全流程管控”。首屏动作包含“下一步操作 销售发货单”“订单列表”“订单明细 1”“新建销售订单”“导入/导出”“合并开票”“刷新”。筛选区包含搜索、范围、状态、开票、收款、发货建单、发货、负责人、客户联系人，并显示合计金额和本页金额。

列表列为：订单编号、客户单号、订单名称、关联合同、客户名称、联系电话、收货地址、所属项目、特价申请、业务状态、使用授信、付款条件、备注、订单金额、开票、发货、收款、订单状态、计划交货日期、负责人、联系人、开单人、创建时间、操作。

当前样例行：`SO-2026-0001`，订单名称“苏州澄岳自动化装备有限公司 - OEM设备销售订单”，关联合同 `SC-OEM-20260909-001`，客户“苏州澄岳自动化装备有限公司”，联系电话 `13800002609`，收货地址“苏州市工业园区澄岳路9号”，所属项目“800型柔性线控制柜交付项目”，业务状态“执行中”，使用授信“否”，付款条件“合同签订后30天内付款”，订单金额 `¥243,200`，开票、发货、收款均为 `0%`，计划交货日期 `2026-10-09`，负责人和开单人均为金一涛，联系人“周启明”。

## Forge 当前表现

### 已落地

- 销售业务菜单中的“框架销售合同”改为业务工作区 `page_sales_contract_workspace`。
- 销售业务菜单中的“销售订单”改为业务工作区 `page_sales_order_workspace`。
- 合同页显示 RISEMAP 当前页的业务标题、页面说明、指标卡、搜索、状态筛选、范围、创建时间降序提示、合同列表关键列和操作。
- 订单页显示 RISEMAP 当前页的业务标题、页面说明、下一步销售发货单入口、订单列表/订单明细页签、筛选方案占位、搜索、状态筛选、范围、订单列表关键列和操作。
- 合同操作保留提交审批、审批通过、从合同创建销售订单，并用两步确认弹窗展示对象、操作和写入影响。
- 订单操作保留提交审批、审批通过、发货建单，并用两步确认弹窗展示对象、操作和写入影响。
- “下一步操作 销售发货单”指向现有销售发货单对象入口，避免跳到不存在的页面。

### 明确差异与处理结论

- RISEMAP 当前合同/订单页还有导入导出、合并开票、完整多条件筛选和用户自定义筛选方案。Forge 本轮先复刻入口、首屏结构、核心列、状态/进度和关键业务动作；批量导入导出、合并开票与筛选方案保持为后续销售块缺口。
- RISEMAP 当前销售导航还显示“附加费用”和“服务管理”分组。Forge 本轮没有推进这些入口的业务页复刻；它们进入销售域后续功能块，不作为本轮合同/订单页通过条件。
- Forge 使用 `Dev Admin` 显示本地负责人；按用户决策，它与 RISEMAP 的金一涛作为同一业务用户对照，不记录为功能缺口。
- Forge 弹窗内容包含操作影响说明，这是 Forge 产品安全决策；即使 RISEMAP 当前操作入口未逐项复核到对应确认内容，也不删除二次确认。

## 验收记录

### 内置浏览器

- 已打开 RISEMAP 合同页并保存 AX 与截图：`risemap-sales-contracts.ax.txt`、`risemap-sales-contracts.png`。
- 已打开 RISEMAP 订单页并保存 AX 与截图：`risemap-sales-orders.ax.txt`、`risemap-sales-orders.png`。
- 已打开 Forge 合同业务工作区并保存 AX 与截图：`forge-sales-contract-workspace.ax.txt`、`forge-sales-contract-workspace.png`。
- 已打开 Forge 订单业务工作区并保存 AX 与截图：`forge-sales-order-workspace.ax.txt`、`forge-sales-order-workspace.png`。
- 已打开 Forge 订单提交审批弹窗，保存第一步业务说明与第二步最终确认：`forge-sales-order-confirm-dialog-step1.ax.txt`、`forge-sales-order-confirm-dialog-step2.ax.txt`。

### API 与持久化

使用同一 SQLite：`/tmp/forge-sales-current-run.sqlite`。服务端口：`4321`。

通过项：

- `acceptance:sales`
- `acceptance:sales-workflow`
- `acceptance:sales-conversion`
- `acceptance:sales-shipment`
- `acceptance:inventory`
- `acceptance:sales-outbound`
- 停服重启后 `acceptance:sales-restart`

工程门禁：

- `pnpm --dir apps/forge-objectstack typecheck`
- `pnpm --dir apps/forge-objectstack validate`
- `pnpm --dir apps/forge-objectstack build`
- `git diff --check`

`validate` 与 `build` 仍有既有的页面 `className` 风格提醒；本轮新页也沿用当前 Forge 产品页的共享 CSS 方案，构建通过。

## 当前状态

框架销售合同与销售订单两个入口已经从通用对象表推进为可对照的业务工作区，完成了 RISEMAP 当前页面首屏结构、核心列表列、关键状态、下一步入口和 Forge 可写动作弹窗的本轮闭环。后续销售域继续按队列补齐销售发货单、收款流水、销售发票、附加费用、销售退货、价格策略与服务管理等页面。
