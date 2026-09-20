# 生产 / 委外管理

当前发现 13 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

## 纵向完成标准

1. 核对主数据和配置依赖，记录必填、默认值、编号及权限。
2. 保存新建表单的空态、校验、填写、提交和成功结果。
3. 跟踪详情页、状态转换、审批、撤回、驳回、作废和恢复。
4. 核对数量、金额、版本、库存或工时在上下游页面的变化。
5. 验证搜索、筛选、排序、分页、批量、导入导出、打印和附件。
6. 用重复提交、非法值、缺少权限、同时编辑和下游失败测试异常分支。
7. 用相关角色分别操作，形成菜单、记录、字段和动作权限矩阵。
8. Forge实现后用同一输入逐项对照外观、行为、数据和恢复结果。

## 页面与当前证据

| 编号 | 入口 | URL | 首屏标题 | 主要操作 | 证据 | 深度状态 |
| --- | --- | --- | --- | --- | --- | --- |
| RM-081 | 进入委外管理上手指南 | `https://risemap.cn/subcontract/guide` | 委外管理上手指南、完整业务流程、准备可用的委外供应商、操作步骤 | 切换到委外业务员、切换到仓库人员、切换到质检 / 收货、切换到财务人员、01 准备供应商 档案与加工能力、02 创建委外订单 提交并完成审核、03 委外发料 甲供料订单、04 回厂验收 良品与不良品、05 异常处理 退料与赔偿、06 对账结算 生成应付、快速开始 2、订单管理 2、发料管理 1、回厂与质检 1、退料与赔偿 2、对账结算 1、库存与报表 2、常见问题 2、标记已掌握、准备可用的委外供应商、先判断订单属于哪种供料方式、打开委外供应商 | [截图](../../../references/risemap-capture/298-rm-081-loaded.png) | 首屏已采集，流程未验证 |
| RM-082 | 委外看板 | `https://risemap.cn/subcontract` | 委外业务全景 | 新建委外订单、进行中订单 0 审批后到对账前、待发料订单 0 甲供料 · 剩余可发、待回厂订单 0 供应商在加工中、待对账订单 0 已完工 · 尚未对账、逾期订单 0 超过期望交期、全部、委外订单、委外发料、委外回厂、委外对账、委外供应商 | [截图](../../../references/risemap-capture/300-rm-082-loaded.png) | 首屏已采集，流程未验证 |
| RM-083 | 委外订单 | `https://risemap.cn/subcontract/orders` | 委外订单 | 进行中订单 0 单 审核后到对账前、待审核 0 单 等待审核处理、逾期未完工 0 单 已超过计划交期、待对账金额 ¥0 订单金额减已对账金额、新建委外订单、导出、导入、导入导出任务、刷新、范围、状态、筛选供应商...、上一页、1、下一页 | [截图](../../../references/risemap-capture/302-rm-083-loaded.png) | 首屏已采集，流程未验证 |
| RM-084 | 委外发料 | `https://risemap.cn/subcontract/issues` | 委外发料 | 全部发料单 0 单 已发出/已签收 0 单、待审核 0 单 等待仓库主管审核、待发料 0 单 审核通过等待执行、待签收 0 单 已发出待供应商确认、新建发料单、导出、导出记录、刷新、状态、筛选供应商...、发料类型、上一页、1、下一页 | [截图](../../../references/risemap-capture/304-rm-084-loaded.png) | 首屏已采集，流程未验证 |
| RM-085 | 委外回厂 | `https://risemap.cn/subcontract/receives` | 委外回厂 | 回厂记录总数 0 单 不含已作废记录、待入库 0 单 入库单等待仓库执行、已入库 0 单 关联入库单已完成、导出、导出记录、刷新、状态、筛选供应商...、上一页、1、下一页 | [截图](../../../references/risemap-capture/306-rm-085-loaded.png) | 首屏已采集，流程未验证 |
| RM-086 | 委外退料 | `https://risemap.cn/subcontract/returns` | 委外退料 | 有效退料单 0 单 不含已作废单据、待入库 0 单 已生成入库单，等待仓库入库、已入库 0 单 退回物料已完成入库、新建退料单、导出、导出记录、刷新、状态、筛选供应商...、退料原因、上一页、1、下一页 | [截图](../../../references/risemap-capture/308-rm-086-loaded.png) | 首屏已采集，流程未验证 |
| RM-087 | 委外对账 | `https://risemap.cn/subcontract/reconciliation` | 委外对账 | 待对账池 0、对账单 0、供应商 (0)、委外订单 (0)、回厂批次 (0)、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/310-rm-087-loaded.png) | 首屏已采集，流程未验证 |
| RM-088 | 委外供应商 | `https://risemap.cn/subcontract/suppliers` | 委外供应商 | 全部工艺能力 | [截图](../../../references/risemap-capture/312-rm-088-loaded.png) | 首屏已采集，流程未验证 |
| RM-089 | 委外库存 | `https://risemap.cn/inventory/subcontract-stock` | 委外厂库存 | 库存管理、去发料、超 30 天 SKU 0 点击仅看超期、全部、导出 | [截图](../../../references/risemap-capture/314-rm-089-loaded.png) | 首屏已采集，流程未验证 |
| RM-090 | 批次追溯 | `https://risemap.cn/subcontract/traces` | 委外批次追溯 | 正向追溯 召回用 材料批次 → 用了它的成品、反向追溯 成品批号 → 它用了哪些材料、追溯、导出 | [截图](../../../references/risemap-capture/316-rm-090-loaded.png) | 首屏已采集，流程未验证 |
| RM-091 | 委外未交 | `https://risemap.cn/subcontract/reports/undelivered` | 委外未交明细表 | 超期行数 / 最长 0 / 0天 点击仅看超期、导出、刷新、超期、筛选供应商...、工艺、上一页、1、下一页 | [截图](../../../references/risemap-capture/318-rm-091-loaded.png) | 首屏已采集，流程未验证 |
| RM-092 | 委外进货 | `https://risemap.cn/subcontract/reports/receipts` | 委外进货明细表 | 导出、刷新、筛选供应商...、上一页、1、下一页 | [截图](../../../references/risemap-capture/320-rm-092-loaded.png) | 首屏已采集，流程未验证 |
| RM-093 | 委外对账单 | `https://risemap.cn/subcontract/reports/reconciliation-statement` | 委外对账单(报表) | 导出、刷新、状态、筛选供应商...、上一页、1、下一页 | [截图](../../../references/risemap-capture/322-rm-093-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0467 | RM-081 | 委外指南业务员视角 | 进入委外管理上手指南 | 业务员关注订单、进度、异常与对账协同，共 6 阶段：准备供应商、创建委外订单、委外发料、回厂验收、异常处理、对账结算；指南目录 8 组共 13 篇。首篇说明供应商需已启用并具备加工能力、联系人和结算条件 | 委外完整闭环从供应商能力准备开始，跨订单、甲供料、验收、不良、赔偿和应付结算 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/923-rm-081-guide-operator-start.png) |
| DR-0468 | RM-081 | 委外指南供料方式 | 打开供料方式说明 | 甲供料由我方提供原料，订单审核后需创建发料单并出库；包工包料由供应商备料，不生成我方发料计划，审核后直接等待回厂。甲供料需仓库协同，回厂需收货/质检；供料不明确时禁止先下单 | 供料方式是委外流程最重要分支，决定库存与发料链是否存在 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/924-rm-081-guide-supply-mode.png) |
| DR-0469 | RM-081 | 委外指南创建订单 | 打开订单管理首篇 | 订单录供应商、来源、供料方式、交期、加工数量单价和结算；甲供料按 BOM 展开发料物料，也可手工补充。提交后待审核；阻塞检查供应商、交期、加工件数量、结算和 BOM | 订单将加工费用、交期和甲供料计划统一建模，审核是后续流程门槛 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/925-rm-081-guide-create-order.png) |
| DR-0470 | RM-081 | 委外指南审核订单 | 打开审核委外订单 | 审核人核对供应商、交期、加工件、价格和甲供料计划；通过后锁定关键业务数据，驳回需填写原因。已审核甲供料等待发料，包工包料等待回厂 | 审核冻结关键订单数据，并按供料方式分流至发料或回厂 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/926-rm-081-guide-audit-order.png) |
| DR-0471 | RM-081 | 委外指南创建发料单 | 打开委外发料指南 | 仅已审核甲供料且仍有待发数量的订单可选；核对仓库、数量和追溯批次，审核后生成委外出库单与库存锁定，状态待发料；库存不足需减量或补库 | 委外发料同时生成库存锁定和出库凭证，订单资格与可用库存是硬前置 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/927-rm-081-guide-issue-material.png) |
| DR-0472 | RM-081 | 委外指南回厂验收 | 打开回厂与质检指南 | 按可回厂订单带入未回厂加工件，登记回厂、合格、不良数量并校验关系；确认后生成待入库数据、更新订单进度。不良可后续赔偿或扣款，回厂不得超过未交 | 回厂登记同时驱动质检、待入库、订单履约和不良责任处理 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/928-rm-081-guide-return-inspection.png) |
| DR-0473 | RM-081 | 委外指南余料退回 | 打开退料指南 | 仅展示有可退在外余量的甲供料订单；退料不得超过在外余量，填写数量原因后确认生成待入库，仓库入库后更新流水与状态；余量可能被倒冲或历史退料核销 | 委外退料以供应商委外仓在外余额为上限，并通过待入库闭环回到本仓 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/929-rm-081-guide-return-material.png) |
| DR-0474 | RM-081 | 委外指南赔偿处理 | 打开不良或超耗赔偿 | 不良回厂或超标准用料形成赔偿，需可追溯来源、责任方与依据；确认责任比例、明细、财务方式后审批，来源回厂需完成入库。通过后进入待对账，作为负向来源抵扣应付 | 赔偿将质量/耗用异常转成可审批的财务扣减，依赖回厂入库完成 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/930-rm-081-guide-compensation.png) |
| DR-0475 | RM-081 | 委外指南对账结算 | 打开对账指南 | 按供应商归集已完成回厂加工费与已审批待对账赔偿，核对加减项、赔偿分配和净应付；审核锁定结果后可生成财务应付。已被其他对账使用的来源不可重复 | 委外对账按可追溯来源汇总正向加工费与负向赔偿，审核后衔接应付 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/931-rm-081-guide-reconciliation.png) |
| DR-0476 | RM-081 | 委外指南供应商库存 | 打开委外库存指南 | 按供应商汇总或按订单物料明细核对累计已发、倒冲消耗、累计退料、在外余量；公式为在外余量=累计已发-倒冲消耗-累计退料。超耗、账龄、余料异常跳订单、退料或赔偿 | 委外库存是甲供料的供应商侧库存子账，完全由发料、回厂倒冲和退料流水驱动 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/932-rm-081-guide-subcontract-stock.png) |
| DR-0477 | RM-081 | 委外指南业务报表 | 打开报表指南 | 委外未交用于剩余交付，委外进货按回厂明细分析数量、良率和加工费，委外对账单按供应商核对结算；差异需统一状态范围、作废记录和统计粒度 | 三张报表分别服务交付、质量成本、结算，口径不可混用 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/933-rm-081-guide-subcontract-reports.png) |
| DR-0478 | RM-081 | 委外指南反审核 | 打开反审核常见问题 | 系统先检查生效的发料、回厂、库存、赔偿、对账下游；必须从最末端撤销/作废后逐级返回，并填写原因。若财务已处理，先确认冲销或调整方案 | 反审核遵循业务依赖拓扑和财务不可逆边界，禁止越级修改源单 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/934-rm-081-guide-reverse-audit.png) |
| DR-0479 | RM-081 | 委外指南无法发料 | 打开发料阻塞常见问题 | 只有已审核未作废/未退回且仍有待发数量的甲供料订单可发料，并要求来源仓可用库存；需核对发料进度和关联单避免重复发料 | 发料资格由供料方式、订单状态、剩余计划、库存及防重共同决定 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/935-rm-081-guide-no-issue-order.png) |
| DR-0480 | RM-081 | 委外指南仓库视角 | 切换仓库人员 | 仓库关注委外发料、退料和在外库存，共 3 阶段：创建订单、委外发料、异常处理；7 篇指南，目录快速开始1、发料2、退料1、库存1、常见问题2，其余禁用 | 仓库角色聚焦甲供料的出库、退回与供应商侧库存，不参与供应商准备、回厂质检和结算 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/936-rm-081-guide-warehouse-overview.png) |
| DR-0481 | RM-081 | 委外指南实际发料与签收 | 打开确认出库与签收 | 待发料且关联出库单可执行时，仓库将库存锁定转实际出库，同时生成原仓出库和供应商委外仓入库流水；交接后登记签收，签收不会自动开始加工，状态已发出或已签收 | 实际发料产生双向库存流水，供应商签收只是交接确认，不等于生产开工 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/937-rm-081-guide-material-dispatch.png) |
| DR-0482 | RM-081 | 委外指南质检收货视角 | 切换质检 / 收货 | 质检收货关注回厂登记、验收结果和不良处理，共 4 阶段：创建订单、回厂验收、异常处理、对账结算；5 篇指南，快速1、回厂1、退料赔偿1、库存报表1、常见问题1 | 质检角色以回厂质量为中心，同时影响赔偿与结算来源 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/938-rm-081-guide-quality-overview.png) |
| DR-0483 | RM-081 | 委外指南财务视角 | 切换财务人员 | 财务关注赔偿抵扣、对账和应付衔接，共 3 阶段：创建订单、异常处理、对账结算；6 篇指南，快速1、赔偿1、对账2、库存报表1、常见问题1 | 财务角色从订单结算条件开始，承接赔偿负项、供应商对账和应付生成 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/939-rm-081-guide-finance-overview.png) |
| DR-0484 | RM-081 | 委外指南生成应付 | 打开从对账生成应付 | 仅已审核且供应商、净应付完整的对账可生成应付；重复执行返回原应付记录。生成后进入付款申请与核销，并可从对账追溯财务应付；还受账号权限控制 | 委外对账到应付是幂等集成，业务来源和财务记录一一可追溯 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-081/940-rm-081-guide-generate-payable.png) |
| DR-0485 | RM-082 | 委外业务全景看板 | 进入委外看板 | 顶部汇总进行中笔数、YTD未结金额、整体良率；指标卡为进行中、待发料、待回厂、待对账、逾期，均可点击。另有我的待办、在途委外订单、快捷入口和最近创建订单，并提供新建委外订单 | 委外看板按订单阶段、资金未结、质量良率、逾期和个人待办组织运营视图 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-082/941-rm-082-dashboard.png) |
| DR-0486 | RM-083 | 委外订单列表 | 进入委外订单 | 说明整件委外/甲供料闭环；指标为进行中、待审核、逾期未完工和待对账金额，前三项可筛选。支持新建、导出、导入、任务、刷新、关键词、范围、状态、供应商。表格列订单号、供应商、关联、付款条件、加工费、发料/回厂/对账进度、交期、操作 | 订单列表同时呈现业务状态、三条履约进度、交期风险和财务未结金额 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/942-rm-083-orders-list.png) |
| DR-0487 | RM-083 | 委外订单范围筛选 | 展开范围 | 下拉显示全部、所有、我负责的；当前文案同时存在“全部”和“所有”两个全量语义项 | 范围筛选区分全量与本人负责，但界面存在重复全量标签，需按实际行为进一步对照 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/943-rm-083-orders-scope-filter.png) |
| DR-0488 | RM-083 | 委外订单状态筛选 | 展开状态 | 可选全部、草稿、待审核、已驳回、已审核、已发料、在外加工、部分回厂、已完工、已对账、已作废，共 11 项并显示数量 | 订单状态贯穿审核、发料、供应商加工、分批回厂、完工与对账 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/944-rm-083-orders-status-filter.png) |
| DR-0489 | RM-083 | 新建委外订单表单 | 点击新建委外订单 | 必填供应商、料权方式、期望交期、付款条件；默认甲供料、手工新建、全检。加工件至少一行，必填物料、加工类型、数量、单价，物料名称规格取主数据，类型需先选供应商；发料计划可按 BOM 展开或手工增加。BOM 只取采购件叶子，数量=单机用量×加工件数×(1+损耗率)，创建发料单时按可用库存推荐来源仓并可调整；标准应耗默认同计划发料 | 委外订单用料权方式控制发料子表，将加工费用、BOM耗用与库存推荐连接；当前付款条件未配置，是创建有效订单的硬缺口 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/945-rm-083-order-create-form.png) |
| DR-0490 | RM-083 | 委外订单草稿最低要求 | 空白表单点击保存草稿 | 提示至少添加一个加工件后再保存草稿；默认展示的空白加工件行不计为有效加工件 | 草稿最低门槛是存在有效加工件，空占位行不进入业务数据 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/946-rm-083-order-draft-validation.png) |
| DR-0491 | RM-083 | 委外订单提交校验 | 空白表单点击提交审核 | 首先提示请选择委外供应商，采用顺序校验；未创建订单 | 正式提交以可用供应商为首个前置，再校验交期、付款条件与有效加工件 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/947-rm-083-order-submit-validation.png) |
| DR-0492 | RM-083 | 委外供应商选择 | 展开供应商 | 支持按名称、编号、联系人搜索，当前无可用供应商 | 委外订单只能引用委外供应商主档，当前试用空间缺少可用供应商 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/948-rm-083-order-supplier-empty.png) |
| DR-0493 | RM-083 | 委外订单料权方式 | 切换包工包料 | 包工包料下整个发料计划区域消失，仅保留加工件；甲供料才需要我方发料计划 | 料权方式是结构性分支，包工包料不生成我方发料计划 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/949-rm-083-order-supply-mode.png) |
| DR-0494 | RM-083 | 委外订单业务来源 | 展开业务来源 | 可选手工新建、关联销售订单、关联生产工单、MRP推送，默认手工新建 | 委外订单可由销售、生产、MRP需求驱动或手工创建 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/950-rm-083-order-source-options.png) |
| DR-0495 | RM-083 | 委外订单验收方式 | 展开验收方式 | 可选全检、抽检-按比例、供应商自检，默认全检 | 验收策略属于订单级质量控制，可交由本方全检、比例抽检或供应商自检 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/951-rm-083-order-inspection-options.png) |
| DR-0496 | RM-083 | 按BOM展开发料前置 | 无加工件时点击按BOM展开 | 提示请先选择加工件物料 | BOM 发料计划必须从有效加工件及其 BOM 派生 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/952-rm-083-order-bom-prerequisite.png) |
| DR-0497 | RM-083 | 加工件物料选择器 | 打开加工件选择 | 两步选择器仅列可委外加工物料，汇总有BOM可一键展开发料、无BOM需手工发料；含分类、显示图片、搜索、物料属性、有无BOM、来源类型筛选和已选计数。当前均为0 | 加工件候选由物料的可委外属性约束，BOM 有无直接决定发料计划生成方式 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/953-rm-083-order-item-picker.png) |
| DR-0498 | RM-083 | 加工件BOM筛选 | 展开有无BOM筛选 | 可选全部、有BOM、无BOM | 加工件可按BOM可用性筛选，以提前判断自动或手工发料路径 | [截图](../../../references/risemap-capture/deep/production/subcontract/rm-083/954-rm-083-order-item-bom-filter.png) |
