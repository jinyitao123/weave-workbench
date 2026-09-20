# 销售管理页面合同（RISEMAP 当前结构对照）

本轮范围：销售业务下的业绩银行、价格策略、Goodwill 订单、销售团队、销售目标。对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。

## 实时入口

- RISEMAP 业绩银行：`https://risemap.cn/sales/performance-bank`
- RISEMAP 价格策略：`https://risemap.cn/sales/pricing`
- RISEMAP Goodwill订单：`https://risemap.cn/sales/goodwill`
- RISEMAP 销售团队：`https://risemap.cn/sales/organization`
- RISEMAP 销售目标：`https://risemap.cn/sales/target`
- Forge 对应页面：`page_sales_performance_bank`、`page_sales_pricing`、`page_goodwill_orders`、`page_sales_teams`、`page_sales_targets`

## RISEMAP 当前事实

业绩银行标题为“业绩银行”，说明为“按已完成销售订单统计业绩，统一沉淀确认、Rebook 与分析结果”。首屏包含所有、我负责的、下属负责的、我关注的范围按钮；指标为累计确认业绩、累计毛利、业绩笔数、待审批；页签为我的业绩银行、业绩流水、Rebook 记录、销售业绩确认、业绩分析；期间按钮为全部、本年、Q1、Q2、Q3、Q4、本月；表头为方向、销售订单号、客户、销售订单额、毛利率、业绩金额、计收比例、时间、操作。

价格策略标题为“价格策略”，说明为“统一管理商品定价、折扣策略、框架协议及特价审批”。首屏功能页签包含物料定价、价格组管理、框架协议价、特价审批、价格调整记录、价格历史。物料定价表头为物料编码、物料名称、规格型号、单位、部门、分类、价格组、成本价、最低售价、建议售价、目录价、状态、操作。当前页面有 5 条控制柜交付物价格记录，状态均显示“待生效”。

Goodwill订单标题为“Goodwill订单”，说明为“客情维护、补偿赠送等无偿订单的审批与发货跟踪”。首屏动作包含新建 Goodwill 订单、刷新、类型、状态、导出、导出任务；表头为 Goodwill单号、客户名称、赠送类型、申请原因、物品种类/总数、状态、负责人、创建日期、创建人、操作。当前列表为空。

销售团队标题为“销售组织管理”，说明为“管理销售团队结构、成员分配和团队负责人”。首屏动作为新建团队和搜索，当前为空态“暂无销售团队，请点击新建团队”。

销售目标标题为“销售目标管理”，说明为“设置和调整销售目标，实时计算完成进度与动态调整建议”。首屏包含新建目标、个人目标、团队目标和 2026 年筛选，当前为空态“暂无数据”。

## Forge 当前表现

Forge 已将上述五个销售业务入口改为独立业务页面。业绩银行读取本地销售订单和客户，按 RISEMAP 的指标、范围、页签、期间和表头展示收入确认后的业绩记录。价格策略读取物料规格、物料和报价明细，按 RISEMAP 的物料定价列结构展示成本价、最低售价、建议售价、目录价和待生效状态。

Goodwill订单、销售团队和销售目标已建立对应业务对象，并按 RISEMAP 当前空态页面展示入口、首屏说明、搜索、表头、刷新和空态。新增按钮保留为当前页面主动作，但本轮没有在 RISEMAP 办理新增流程，因此 Forge 不把新增、审批或发货流转写成已完成路径。

## 证据材料

- RISEMAP：`docs/references/risemap-capture/live/20260913-sales-full/risemap-sales-performance-bank-menu.*`、`risemap-sales-pricing-menu.*`、`risemap-sales-goodwill-orders-menu.*`、`risemap-sales-teams-menu.*`、`risemap-sales-targets-menu.*`
- Forge：`docs/references/risemap-capture/live/20260913-sales-full/forge-sales-performance-bank.*`、`forge-sales-pricing.*`、`forge-sales-goodwill-orders.*`、`forge-sales-teams.*`、`forge-sales-targets.*`

## 验收结论

当前可验收范围是销售管理五个入口的实时首屏结构、指标、表头、筛选/页签、空态或本地只读记录展示。Goodwill 新增审批、销售团队成员维护和销售目标计算仍需在 RISEMAP 有同材料办理后继续复核。

## 2026-09-13 同材料补证：销售团队、销售目标、Goodwill订单

本轮已按当前线上 RISEMAP 页面重新补证，仍以 RISEMAP 当前页面为首要事实来源。新增 RISEMAP 数据均使用 `RISEMAP 对照…20260913` 标识，只做新增与读取。

### 销售团队

- RISEMAP 当前事实：入口 `https://risemap.cn/sales/organization`，页面标题为“销售组织管理”，说明为“管理销售团队结构、成员分配和团队负责人”，动作包含“新建团队”和搜索。已新增团队 `RISEMAP 对照销售团队 20260913`，负责人 `金一涛`，成员 `1人`，创建日期 `2026-09-13`。
- Forge 当前表现：入口 `page_sales_teams`，页面标题、说明、搜索、表头和新建团队动作对齐；已新增 `RISEMAP 对照销售团队 20260913`，负责人显示 `Dev Admin`，成员 `1 人`，状态 `启用`。
- 处理结论：`金一涛` 与 `Dev Admin` 按同一业务用户对照，不作为差异。Forge 以表格承载团队记录，属于 Console 统一呈现差异。

### 销售目标

- RISEMAP 当前事实：入口 `https://risemap.cn/sales/target`，页面标题为“销售目标管理”，说明为“设置和调整销售目标，实时计算完成进度与动态调整建议”，动作包含“新建目标”、个人目标、团队目标和 `2026年`。新建个人目标字段包含目标类型、选择人员、合同额目标、回款目标、平均分配、12 个月合同额/回款字段和备注。已新增 `金一涛 · RISEMAP 对照销售团队 20260913`，合同额目标 `¥1,000,000.00`，回款目标 `¥800,000.00`，状态 `草稿`，完成进度 `0%`。
- Forge 当前表现：入口 `page_sales_targets`，页面按个人/团队和年度展示目标；已新增 `Dev Admin` 个人目标，合同额 `¥ 1,000,000.00`，回款 `¥ 800,000.00`，完成进度 `0 %`，状态 `草稿`。月度平均分配以备注记录 `83333...83337` 与 `66666...66674`，用于保持 API 回读材料。
- 处理结论：人员名称按业务用户映射处理；Forge 目前没有展开 12 个月可编辑网格，先以月度分配摘要保留计算结果，这是页面交互待继续细化项，不影响本轮目标字段与状态对照。

### Goodwill订单

- RISEMAP 当前事实：当前可用入口为 `https://risemap.cn/sales/goodwill`，此前尝试的 `/sales/goodwill-orders` 不是有效 Goodwill 列表入口。列表包含新建、刷新、类型、状态、导出、导出任务，表头为 Goodwill单号、客户名称、赠送类型、申请原因、物品种类/总数、状态、负责人、创建日期、创建人、操作。已新增详情 `GW-2026-0001`，状态 `草稿`，客户 `苏州澄岳自动化装备有限公司`，联系人 `周启明 / —`，负责人 `金一涛`，赠送类型 `RISEMAP 对照赠送类型 20260913`，申请原因和备注为同材料文本，物品种类 `1`，物品总数 `2`。
- Forge 当前表现：入口 `page_goodwill_orders`，页面标题、说明、搜索、表头和空态对齐；新建弹窗包含客户名称、联系人、负责人、赠送类型、申请原因、物品清单、备注。当前本地库无客户时，保存会先补建同材料客户分类与客户档案，再创建 `GW-FORGE-20260913`。创建后列表展示客户、赠送类型、申请原因、物品 `800型柔性线控制柜 / 2 台`、负责人 `Dev Admin`、创建人 `Dev Admin`。
- Forge 产品决策：`提交审批` 使用两层 ObjectStack 标准弹窗，第一层核对订单、客户、当前状态，第二层明确“提交后订单进入待审批，后续才能继续发货。”确认后状态变为 `待审批`。
- 处理结论：RISEMAP 当前详情停留在 `草稿`，Forge 的 `待审批` 是本地可写执行扩展，不能写成 RISEMAP 已提交审批事实。删除、打印、发货后续流转未在本轮对 RISEMAP 执行。

### 新增证据材料

- RISEMAP：`docs/references/risemap-capture/live/20260913-sales-data/risemap-sales-team-current-before-submit.*`、`risemap-sales-team-created.*`、`risemap-sales-target-form-filled.*`、`risemap-sales-target-created.*`、`risemap-goodwill-form-filled-selected-item.*`、`risemap-goodwill-created.*`、`risemap-goodwill-detail-current-recheck.*`。
- Forge：`docs/references/risemap-capture/live/20260913-sales-data/forge-sales-team-created-recheck.*`、`forge-sales-target-created-draft-recheck.*`、`forge-goodwill-empty-after-fix.*`、`forge-goodwill-form-official.*`、`forge-goodwill-created-official.*`、`forge-goodwill-submit-review.*`、`forge-goodwill-submit-confirm.*`、`forge-goodwill-pending-approval.*`。

## 2026-09-13 Goodwill 审批发货补充

RISEMAP 当前事实：`https://risemap.cn/sales/goodwill/2099141151628992514` 中 `GW-2026-0001` 已处于 `发货中`，详情页显示客户、联系人、负责人、赠送类型、申请原因、收货地址、物品种类、物品总数、发货单数、已发数量，并提供 `确认完成`、`反审核`、`一键反审核`、`打印`。本轮只读取并保存证据，没有继续确认完成线上单据。

Forge 当前表现：`page_goodwill_orders` 已支持 Goodwill 列表、新建、提交审批、同意审批、创建发货、发货中记录和确认完成弹窗。`GW-FORGE-20260913` 通过内置浏览器实际操作到 `发货中`，列表显示审批通过、`DN-GW-20260913-001`、发货记录 1、已发 2 台、收件人 `周启明 13800002609`、地址 `苏州市工业园区澄岳路9号`、无物流信息。`金一涛` 与 `Dev Admin` 按同一业务用户对照。

明确差异与结论：Forge 的完成态已实现并通过脚本验收，但本轮未执行 RISEMAP `确认完成`，因此完成态标为 Forge 可写扩展，待 RISEMAP 后续同材料复核。页面可见文案已改为业务语言，不再显示内部验收标语。
