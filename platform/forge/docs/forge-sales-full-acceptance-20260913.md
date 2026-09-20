# 销售业务整块验收记录（2026-09-13）

本轮目标：以 RISEMAP 当前销售页面为首要基线，把 Forge 销售整块从零散对象页和目录页推进为可逐项对照的业务页面结构，并保留已具备的本地可写执行能力。对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。

## 已实时打开的 RISEMAP 页面

销售业务：框架销售合同、销售订单、附加费用、收款流水、销售发货单、销售退货、业绩银行、价格策略、Goodwill订单、销售团队、销售目标、销售发票。

CRM客户管理：客户管理、联系人管理、销售报价、客户物料对照、商机管理、线索管理、跟进记录、公海客户。

服务管理：服务工单、服务报价单、服务结算单、接单中心、派工中心、服务分析、质保管理、服务配置。

供应链承接：待出库发货单、出库单列表。

实时证据目录：`docs/references/risemap-capture/live/20260913-sales-full/`。

## Forge 已完成的页面结构

销售业务已形成独立页面：框架销售合同、销售订单、附加费用、收款流水、销售发货单、销售退货、业绩银行、价格策略、Goodwill订单、销售团队、销售目标、销售发票。

CRM客户管理已形成独立页面：客户管理、联系人管理、销售报价、客户物料对照、商机管理、线索管理、跟进记录、公海客户。

服务管理已新增为销售导航分组并形成独立页面：服务工单、服务报价单、服务结算单、接单中心、派工中心、服务分析、质保管理、服务配置。

出库承接已形成独立页面：待出库发货单、出库单列表。

## 本轮实现边界

已完成：销售菜单结构、页面标题、页面说明、指标卡、页签/范围按钮、筛选区、表头、分页、空态、下一步入口和本地执行结果回读。已具备本地可写动作的页面继续保留二次确认，包括合同/订单关键流转、发货、待出库转出库、收款分配/取消/撤销、销售退货草稿、附加费用草稿等。

当前 RISEMAP 多个页面为空或账号缺少可办理服务人员档案，因此 Goodwill 新增审批、团队成员维护、目标计算、CRM 线索转商机、跟进日历、服务工单派发、工程师接单、服务报价转结算、质保激活和服务配置新增没有写成 RISEMAP 已跑通业务闭环。

## 工程和页面验收

- `pnpm --dir apps/forge-objectstack typecheck`：通过。
- `pnpm --dir apps/forge-objectstack validate`：通过。
- `pnpm --dir apps/forge-objectstack build`：通过。
- `git diff --check`：通过。
- 同 SQLite 手动停服重启：`/tmp/forge-sales-shipment-final.sqlite`，重启后服务为 `http://localhost:4321/`。
- `FORGE_URL=http://localhost:4321 FORGE_DB=/tmp/forge-sales-shipment-final.sqlite pnpm --dir apps/forge-objectstack acceptance:sales-restart`：通过。
- 重启后内置浏览器全量回读 CRM 与服务管理 16 个入口：全部通过，无加载停滞，无控制台错误。
- 重启后内置浏览器关键销售页回读：框架销售合同、销售订单、销售发货单、附加费用、销售退货、价格策略、客户管理、商机管理、服务工单、派工中心、服务配置均通过。

## 结论

销售整块已经从页面结构、导航入口、首屏字段、表格列、空态和已实现本地业务动作层面形成可验收闭环。尚未在 RISEMAP 有可办理数据的路径保持为“待同材料办理复核”，不冒充已完成端到端业务流。

## 2026-09-13 服务工单同材料补验收

用户已授权在 RISEMAP 试用环境补充合适的对照数据。本轮只做新增和读取，没有删除、作废、撤销或修改既有线上业务数据。

已实时打开并办理的 RISEMAP 页面：

- `https://risemap.cn/after-sales/config`：新增服务类型和服务人员。
- `https://risemap.cn/after-sales/orders`：新建服务工单。
- `https://risemap.cn/after-sales/orders/2099134912170762242`：完成受理、派工、工程师接单，最终状态 `服务中`。

已实时打开并办理的 Forge 页面：

- `http://localhost:4321/_console/apps/forge/page/page_service_orders`：补入同材料配置、新建服务工单、提交前确认、受理、派工、工程师接单，最终状态 `服务中`。
- `http://localhost:4321/_console/apps/forge/page/page_service_dispatch`：回读同一工单，显示状态 `服务中` 和服务工程师。
- `http://localhost:4321/_console/apps/forge/page/page_service_config`：回读同名服务类型和服务人员，分类/状态均为业务文案。

同材料对照结论：

- RISEMAP 工单 `WO-2026-0001` 与 Forge 工单 `WO-FORGE-20260913` 使用同一业务客户、联系人、电话、服务类型、上门服务、紧急度、服务地址、问题描述、故障现象、影响范围、质保日期和服务工程师。
- RISEMAP 销售订单/合同为 `SO-2026-0001` / `SC-OEM-20260909-001`；Forge 本地对应订单/合同为 `SO-WF-20260909-001` / `SC-CONVERT-20260909-001`。这是本地对照材料编号映射，不是页面结构或字段缺失。
- RISEMAP 和 Forge 均已从提交后待受理推进到待分派、待接单、服务中。Forge 采用 ObjectStack 标准弹窗承载提交前确认、受理确认、派工和接单确认。
- 质保卡、服务结果、报价单、结算单、应收承接还没有 RISEMAP 同材料最终办理结果，本轮不写成已完成端到端闭环。

新增证据目录：`docs/references/risemap-capture/live/20260913-sales-data/`。浏览器控制台错误文件 `forge-service-browser-console-errors-final.json` 为空数组。

## 2026-09-13 销售管理同材料补验收

本轮已在已登录内置浏览器中重新打开并核对 RISEMAP 与 Forge 页面。新增 RISEMAP 数据均带 `RISEMAP 对照…20260913` 标识，只做新增和读取，没有删除、作废、撤销或修改既有线上业务数据。

已实时打开并办理的 RISEMAP 页面：

- `https://risemap.cn/sales/organization`：新建销售团队 `RISEMAP 对照销售团队 20260913`，负责人 `金一涛`，创建后列表显示 `1人`。
- `https://risemap.cn/sales/target`：新建 2026 年个人销售目标，人员为 `金一涛 · RISEMAP 对照销售团队 20260913`，合同额目标 `1000000`，回款目标 `800000`，平均分配后创建为 `草稿`。
- `https://risemap.cn/sales/goodwill` 与 `https://risemap.cn/sales/goodwill/2099141151628992514`：新建赠送类型和 Goodwill 订单，详情显示 `GW-2026-0001`、状态 `草稿`、客户 `苏州澄岳自动化装备有限公司`、联系人 `周启明`、负责人 `金一涛`、物品种类 `1`、物品总数 `2`。

已实时打开并办理的 Forge 页面：

- `http://localhost:4321/_console/apps/forge/page/page_sales_teams`：新建并回读 `RISEMAP 对照销售团队 20260913`，负责人 `Dev Admin`，成员 `1 人`，状态 `启用`。
- `http://localhost:4321/_console/apps/forge/page/page_sales_targets`：新建并回读 2026 年个人目标，合同额 `¥ 1,000,000.00`，回款 `¥ 800,000.00`，完成进度 `0 %`，状态 `草稿`。
- `http://localhost:4321/_console/apps/forge/page/page_goodwill_orders`：通过页面新建 `GW-FORGE-20260913`，自动补建同材料客户分类和客户档案；列表回读为 `草稿` 后，通过两层标准确认弹窗提交审批，刷新后状态为 `待审批`。

同材料对照结论：

- 销售团队、销售目标、Goodwill 的入口、标题、业务说明、主要字段、列表列、空态、新建表单字段和创建后关键状态已形成可验收页面链路。
- `金一涛` 与 `Dev Admin` 继续按同一业务用户对照，不作为功能缺口。
- RISEMAP Goodwill 当前详情仍为 `草稿`，Forge `待审批` 是本地可写执行扩展；本轮只把二次弹窗和状态推进作为 Forge 产品安全决策验收，不冒充 RISEMAP 已提交审批。
- RISEMAP 的 Goodwill 物品名称必须通过物品选择器选中，手工输入未被接受；Forge 当前用物品名称文本承载同材料，后续如要继续发货/库存联动，需要把物品选择器升级为真实物料引用。

新增 API 验收：`FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-management-data` 已通过，报告写入 `apps/forge-objectstack/.objectstack/acceptance/sales-management-data-report.json`。

同一 SQLite 停服重启回读：

- 已停止 `http://localhost:4321/` 的 Forge 开发服务，并从同一数据库 `apps/forge-objectstack/.objectstack/data/objectstack.db` 重启。
- 重启后 API 验收 `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-management-data` 通过，销售团队、销售目标、Goodwill 订单、客户和客户分类均按同一 ID/业务字段读回。
- 重启后内置浏览器回读 `page_sales_teams`、`page_sales_targets`、`page_goodwill_orders` 均通过；新增证据为 `forge-sales-team-restart-readback.*`、`forge-sales-target-restart-readback.*`、`forge-goodwill-restart-readback.*`。
- 旧的 `acceptance:sales-restart` 在当前 4321 数据库上未作为本轮销售管理验收门禁，因为其报告 ID 指向先前 `/tmp/forge-sales-shipment-final.sqlite` 中的客户、联系人和仓库基础材料；当前目标的销售管理同材料读回已由独立验收脚本覆盖。

## 2026-09-13 销售主链当前库闭环

本轮按固化步骤重新打开 RISEMAP 当前销售页面，并在 Forge 当前 `http://localhost:4321/` 的同一 SQLite 数据库中重建销售主链验收。对照账号继续按 `金一涛` 与 `Dev Admin` 同一业务用户处理。

已实时打开并保存证据的 RISEMAP 页面：

- `https://risemap.cn/sales/contracts`：框架销售合同。
- `https://risemap.cn/sales/orders`：销售订单。
- `https://risemap.cn/sales/outbound`：销售发货单。
- `https://risemap.cn/sales/invoices`：销售发票。
- `https://risemap.cn/sales/collection-flow`：收款流水。
- `https://risemap.cn/sales/performance-bank`：业绩银行。
- `https://risemap.cn/sales/quotations`：销售报价。
- `https://risemap.cn/after-sales/orders`、`/quotations`、`/settlements`：服务工单、服务报价单、服务结算单。

RISEMAP 当前事实摘要：销售模块分为销售业务、CRM 客户管理、服务管理三组；销售订单页显示订单 `SO-2026-0001`，客户 `苏州澄岳自动化装备有限公司`，关联合同 `SC-OEM-20260909-001`，金额 `¥243,200.00`，负责人 `金一涛`。当前 RISEMAP 线上数据没有被删除、作废或撤销。

Forge 当前库执行结果：

- 重新写入当前库引用主数据，消除了旧 SQLite 报告 ID 对当前 4321 库的依赖。
- 报价、报价审批、发送、客户接受、报价转合同、合同审批、合同转订单、订单审批通过。
- 从同一订单生成两张发货单，并分别完成两笔真实出库，出库后库存从 `3 → 2 → 1`。
- 生成两张销售发票和两笔应收，总额 `¥243,200.00`。
- 登记三笔收款 `60000 + 61600 + 121600`，分配到两笔应收并审核核销；两张发票和两笔应收均结清，订单与合同已收金额均为 `¥243,200.00`。
- 由两笔出库来源生成并审核两笔收入确认，订单累计确认收入 `¥243,200.00`。中间保留一条被驳回的收入确认作为可恢复历史，不作为有效确认金额。

当前库验收脚本：

- `node scripts/seed-reference-data.mjs`：通过。
- `pnpm acceptance:sales`：通过。
- `pnpm acceptance:sales-workflow`：通过。
- `pnpm acceptance:sales-conversion`：通过。
- `node tests/inventory-opening.integration.mjs`：通过。
- `pnpm acceptance:sales-shipment`：通过。
- `pnpm acceptance:sales-outbound`：通过。
- `pnpm acceptance:sales-finance`：通过。
- `node tests/sales-split-fulfilment.integration.mjs`：通过。
- `pnpm acceptance:revenue-recognition`：通过。
- `pnpm acceptance:sales-current-collection-restart`：通过。
- `pnpm acceptance:sales-current-revenue-final`：通过。
- `pnpm acceptance:sales-current-main-chain-restart`：通过。

同一 SQLite 停服重启回读：已停止原 4321 Forge 服务，只保留内置浏览器网络进程；随后使用同一 `apps/forge-objectstack/.objectstack/data/objectstack.db` 重启。重启后 `pnpm acceptance:sales-current-main-chain-restart` 读取同一批订单、合同、发货单、出库单、发票、应收、收款流水、核销记录和收入确认，结果通过。

重启后内置浏览器已回读 Forge 页面：

- `page_sales_order_workspace`：`SO-CONVERT-20260909-001` 显示发货、开票、收款均 `100%`，业务状态为已发货。
- `page_sales_shipment_workspace`：`DN-CONVERT-20260909-001` 与 `SPLIT-DN-2` 均为已出库。
- `page_sales_outbound_list`：`OUT-CONVERT-20260909-001` 与 `SPLIT-OUT-2` 均为已出库，收入确认列为已审批。
- `page_sales_invoice_request`：两张发票均显示已开票，应收余额为 `¥0.00`。
- `page_sales_collection_flow`：三笔 `CR-SALES-*` 收款流水合计 `¥243,200.00`，全部已分配。
- `page_revenue_recognition`：有效确认净收入 `¥243,200.00`，两笔有效确认单为已审核。

证据目录：`docs/references/risemap-capture/live/20260913-sales-current-db/`。

结论：销售主链在 Forge 当前库已经补成可验收闭环。尚未全部完成的是销售整块外围功能，包括销售退货、附加费用、价格策略、CRM 线索/商机/跟进/公海转化、服务报价转结算、质保激活、服务分析和多角色权限差异。这些不能因销售主链闭环而合并宣称全部完成。

## 2026-09-13 Goodwill 审批发货补闭环

本轮重新使用内置浏览器打开 RISEMAP 当前详情页 `https://risemap.cn/sales/goodwill/2099141151628992514`。当前事实为：`GW-2026-0001` 处于 `发货中`，客户为 `苏州澄岳自动化装备有限公司`，联系人 `周启明 / 13800002609`，负责人、创建人和审批人均为 `金一涛`，物品为 `800型柔性线控制柜 x2`，收货地址为 `苏州市工业园区澄岳路9号`，页面存在 `确认完成`、`反审核`、`一键反审核`、`打印`，并显示 `发货记录 1`、`审批记录 1`、`操作记录 4`、`已发数量 2`。本轮没有继续点击 RISEMAP 的 `确认完成`，避免继续改动线上业务数据。

Forge 已补齐 Goodwill 订单字段、动作和页面：联系人、联系电话、物品名称、数量、单位、审批人、审批时间、发货单号、发货状态、发货记录数、已发数量、物流公司、运单号、收货地址、收件人、发货时间和完成时间均落入 `forge_goodwill_order`。页面支持 `草稿 -> 待审批 -> 已审批 -> 发货中 -> 已完成`，并为提交审批、同意、创建发货和确认完成提供标准弹窗。浏览器已实际操作 `GW-FORGE-20260913` 完成同意审批和创建发货，最终停在 `发货中`，与 RISEMAP 当前状态对齐；同时打开并保存了 `确认完成` 的两层确认弹窗证据，但未对这条对照单执行最终完成。

本轮保存的页面证据位于 `docs/references/risemap-capture/live/20260913-sales-current-db/`：

- RISEMAP：`risemap-goodwill-current-shipping-readback.body.txt`、`risemap-goodwill-current-shipping-readback.dom.txt`、`risemap-goodwill-current-shipping-readback.png`。
- Forge：`forge-goodwill-approval-dialog-step1.*`、`forge-goodwill-approval-dialog-confirm.*`、`forge-goodwill-shipment-dialog-step1.*`、`forge-goodwill-shipment-dialog-confirm.*`、`forge-goodwill-after-shipment.*`、`forge-goodwill-complete-dialog-step1.*`、`forge-goodwill-complete-dialog-confirm.*`。

工程验收：

- `acceptance:sales-goodwill-flow` 通过，覆盖审批前禁止发货、提交审批、同意审批、发货必填阻断、创建发货和 Forge 完成态。
- `acceptance:sales-goodwill-flow-restart` 通过，证明脚本生成的 Goodwill 完成态可在同一 SQLite 停服重启后回读。
- `acceptance:sales-goodwill-ui-operated-readback` 通过，证明浏览器实际操作的 `GW-FORGE-20260913` 在当前 SQLite 中保持 `发货中`、发货记录 1、已发数量 2、收件信息完整。
- `acceptance:sales-visible-language-cleanup` 通过，证明销售管理和服务管理当前可见记录中不再包含内部验收话术。

结论：Goodwill 审批和创建发货已经形成 RISEMAP 当前页面与 Forge 本地页面的同材料闭环。RISEMAP 的最终 `确认完成` 没有执行，Forge 完成态只作为可写执行扩展保留，后续若要把 Goodwill 完成态标为 RISEMAP 对照通过，需要在 RISEMAP 用同一单据或新单据完成一次最终确认。

## 2026-09-13 CRM 后续流转同材料补闭环

用户已明确授权在 RISEMAP 中补充合理业务数据。已登录内置浏览器中，本轮在 RISEMAP 直接创建并办理 CRM 数据，只做新增、转化、领取和读取，没有删除、作废、撤销或权限变更。

已实时打开并办理的 RISEMAP 页面：

- `https://risemap.cn/sales/leads`：新建线索 `LEAD-2026-0001`，客户 `苏州澄岳自动化装备有限公司`，联系人 `周启明`，来源 `官网注册`，预估金额 `¥320,000`，负责人 `金一涛`。
- `https://risemap.cn/sales/leads`：点击线索行 `转化`，弹窗带出来源、商机名称、预计金额、预计关闭日期、商机阶段、客户名称和备注；提交后跳转到商机管理。
- `https://risemap.cn/sales/opportunities`：回读商机 `OPP-2026-0001`，阶段 `初步接触`，金额 `¥320,000`，负责人 `金一涛`。本次发现 RISEMAP 实际保存的预计成交日期仍为 `2026-06-30`，与输入日期不一致，按当前事实记录。
- `https://risemap.cn/sales/follow-ups`：新建上门拜访跟进记录，客户为 `苏州澄岳自动化装备有限公司`，内容、结果和下次跟进行动均回到列表；联系人和关联商机选择器本轮没有展开出可选项，按客户级跟进完成。
- `https://risemap.cn/sales/public-sea`：新建公海客户 `无锡云起智能装备有限公司`，联系人 `许明远`，城市 `无锡`，来源 `新建`；点击 `领取` 后出现 `确认领取客户` 弹窗，确认后公海列表回到 0 条。
- `https://risemap.cn/base/customers`：领取后客户管理页仍显示 0 条；这说明 RISEMAP 当前版本的公海领取结果没有立即在该客户管理列表显式回读，不能把这一点当作 Forge 必须复刻的客户名册结果。

已实时打开并办理的 Forge 页面：

- `http://localhost:4321/_console/apps/forge/page/page_sales_leads`：线索列表已加入业务按钮 `转化`，弹窗分表单和二次确认两步；浏览器实际提交 `LEAD-UI-20260913154204` 后，页面出现 `线索已转为客户和商机`，统计变为 `新线索 0 / 已转化 3`，当前行状态为 `已转化`。
- `http://localhost:4321/_console/apps/forge/page/page_customer_pool`：公海列表已加入 `领取` 业务按钮和标准确认弹窗；浏览器实际领取 `无锡云起智能装备有限公司-20260913154204` 后，API 回读状态为 `claimed`，刷新页面显示 `已领取 / 已进入客户档案`。
- `http://localhost:4321/_console/apps/forge/page/page_warranty_management`：质保卡状态文案从技术态 `active` 改为业务态 `生效中`，页面回读 `WC-20260913152607` 状态列为 `生效中`。

Forge 实现补充：

- 线索转商机和公海领取动作从事务包装改为顺序写入，避免当前运行时在该动作路径上等待超时。保留状态校验、客户档案创建、商机创建、领取回写和结果返回。
- 线索管理页和公海客户页从只读通用列表升级为可见业务办理页，关键动作均使用 ObjectStack / Forge 标准弹窗，不使用浏览器原生确认框。
- `金一涛` 与 `Dev Admin` 继续按同一业务用户对照，不作为功能缺口。

证据目录：`docs/references/risemap-capture/live/20260913-sales-current-db/`，新增文件包含 `risemap-sales-lead-after-create-20260913.*`、`risemap-sales-lead-convert-dialog-20260913.*`、`risemap-sales-opportunity-after-lead-convert-20260913.*`、`risemap-sales-followup-after-create-20260913.*`、`risemap-sales-public-sea-claim-confirm-20260913.*`、`risemap-sales-public-sea-after-claim-20260913.*`、`forge-sales-lead-after-ui-convert-20260913.*`、`forge-sales-public-sea-after-ui-claim-20260913.*`、`forge-warranty-status-business-label-20260913.*`。

工程验收：

- `pnpm --dir apps/forge-objectstack typecheck`：通过。
- `pnpm --dir apps/forge-objectstack validate`：通过。
- `pnpm --dir apps/forge-objectstack build`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-current-main-chain-restart`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-goodwill-ui-operated-readback`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-service-followup-restart`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-crm-followup-flow`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-crm-followup-restart`：通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-visible-language-cleanup`：通过。
- 完整停止 4321 服务后，从同一 `apps/forge-objectstack/.objectstack/data/objectstack.db` 重启，再次运行主链、Goodwill、服务、CRM 和文案清理读回脚本，全部通过。

结论：销售主链、Goodwill 审批发货、CRM 线索转商机/跟进/公海领取、服务后续流转已经在当前 SQLite 形成实现、页面、API 和重启回读闭环。仍未写成 RISEMAP 对照闭环的是 RISEMAP 当前没有实际办理或未成功展开的细节，如 CRM 联系人/商机关联选择器、销售报价端新建转订单、服务报价/结算在 RISEMAP 的同材料终态、以及更深的权限差异。

## 2026-09-14 服务后续流转可用性修正

本轮按用户新增要求补充检查页面控件是否符合实际产品布局和人类使用习惯，以及按钮是否真的可用。

RISEMAP 实时补证结论：服务工单 `WO-2026-0001` 仍处于 `服务中`。直接提交服务结果会提示 `请至少填写一条处理记录后再提交服务结果`；处理记录保存时必须至少上传一张现场处理图片。服务报价单当前无记录，入口为 `新增服务报价单`；服务结算单当前无记录，入口为 `从完工工单新建`；质保管理当前 0 张卡。

Forge 修正结论：服务工单页的服务中状态现在只有真实可用的 `提交服务结果` 按钮；处理记录和预约客户保留为待继续复核说明，不再做成不可用按钮。提交服务结果弹窗补齐服务耗时、处理记录、现场图片数和服务结果，并把确认按钮文案修为 `确认提交服务结果`。完工后可从同一页面实际点击 `生成报价`、`生成结算`、`生成质保`，其中 `生成结算` 按 RISEMAP 当前入口从完工工单直接创建；完成后按钮改为结果文本。

新增工程验收覆盖：`acceptance:sales-service-followup-flow` 已检查处理记录阻断、现场图片数阻断、完工、报价、从完工工单生成结算、应收和质保卡。

## 2026-09-14 控件可用性与产品语言清理补证

本轮根据页面复刻的可用性要求，把“看起来像按钮但不能办理”的控件作为缺陷处理，而不是只做文案清理。产品页面不再展示 `RISEMAP`、`同材料复核`、`结构已落地`、`当前工程`、`技术 ID` 等内部复刻或工程验收语言；此类内容只保留在页面合同和验收记录中。

处理结论：

- 销售与服务页面中的保留能力改为业务说明，例如“请从对应业务单据发起”“请通过客户释放或导入进入公海池”“导出：待开放”。
- 服务工单页的“工单列表 / 服务中 / 已完工”改为真实页签筛选；“全部类型 / 全部状态”改为真实下拉筛选；清空筛选会同时恢复搜索、类型、状态和页签。
- 服务中工单只保留真实可执行的“提交服务结果”；处理记录、预约客户和到场信息以业务说明呈现，不再伪装成按钮。
- 服务报价单和服务结算单页面的新增入口改为业务提示，实际生成仍从已完工服务工单发起，避免用户在列表页看到无法办理的主按钮。
- 线索管理、公海客户、附加费用、销售退货、出库列表、图纸与工程变更、委外发料等页面已清理内部验收词和静态假按钮；正常禁用只保留提交中、必填不足、库存不足或分页边界等真实状态阻断。

内置浏览器复查：

- `http://localhost:4321/_console/apps/forge/page/page_service_orders`：无内部复刻词；实际点击“服务中”页签后列表从 6 条收敛为 1 条，点击“已完工”后为 5 条，清空筛选后恢复 6 条；已完工行不再显示“提交服务结果”。
- `http://localhost:4321/_console/apps/forge/page/page_service_quotations`：无内部复刻词；顶部只保留刷新、搜索和清空筛选，新增服务报价提示为业务来源说明。
- `http://localhost:4321/_console/apps/forge/page/page_service_settlements`：无内部复刻词；顶部只保留刷新、搜索和清空筛选，服务结算提示为从业务单据发起。
- `http://localhost:4321/_console/apps/forge/page/page_sales_leads`、`page_customer_pool`、`page_sales_return_workspace`、`page_sales_outbound_list`：无内部复刻词，无静态禁用占位按钮。
- `http://localhost:4321/_console/apps/forge/page/page_drawing_workspace`：无内部复刻词；只看到分页边界的“上一页 / 下一页”禁用，属于真实分页状态。
- `http://localhost:4321/_console/apps/forge/page/page_subcontract_issue_workspace`：无内部复刻词；供应商和发料类型改为业务说明，状态筛选仍可用。

工程门禁：

- `pnpm --dir apps/forge-objectstack typecheck` 通过。
- `pnpm --dir apps/forge-objectstack validate` 通过，仍保留既有 ADR-0065 className 警告。
- `pnpm --dir apps/forge-objectstack build` 通过，仍保留既有 ADR-0065 className 警告。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-service-followup-flow` 通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-service-followup-restart` 通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:sales-visible-language-cleanup` 通过。

剩余边界：RISEMAP 线上服务工单提交服务结果仍受“至少上传一张现场处理图片”阻断；当前未上传文件，因此 RISEMAP 服务结果终态仍不能写成同材料完整闭环。Forge 本地服务后续流转已经可用，但最终仍标为 Forge 可写执行扩展，等待 RISEMAP 同材料补证。

## 2026-09-14 控件布局与真实可用性补充

本轮把“控件是否符合实际产品布局和人类使用习惯、是否真的可用”补入项目复刻规则，并按 RISEMAP 当前页面重新检查生产/委外承接入口。

- RISEMAP 当前对照页：`/production/assembly`，确认组装单首屏为标题说明、四个指标卡、状态标签、列表工具栏、搜索框、列表和分页；`/subcontract/orders`，确认委外订单首屏为四个指标卡、新建/导入导出工具栏、范围/状态/供应商筛选、搜索框和订单列表。
- Forge 组装单：把指标卡从纵向堆叠调整为列表页可扫读的四卡布局，补齐状态标签、搜索框、清空筛选、刷新、分页说明和来源订单/创建信息列；导入导出未作为假按钮保留，改成生产数据任务说明；没有生效 BOM 时显示业务前置提示。
- Forge 委外订单：补齐 RISEMAP 对应的四个业务指标卡；订单范围、订单状态、供应商筛选由原来“能展开但不筛选”改为真实筛选；指标卡也能直接切换列表范围。内置浏览器已验证待审核指标、重置、搜索过滤均有真实列表反馈。
- 结论：以上两页本轮证明的是页面控件布局与基础可用性修正；RISEMAP 当前生产/委外线上页面缺少可办理数据，后续业务闭环仍以 Forge 本地同库执行和待 RISEMAP 同材料补证分层记录。

### 生产组装页面真实可用性补证

- RISEMAP 当前事实：`/production/assembly` 可打开，首屏包含组装业务管理侧边入口、组装单标题说明、组装单总数/进行中/累计合格入库/累计物料投入四个指标、状态标签、新建组装单、导出、导入/导出任务、刷新、搜索框、列表列和分页；当前线上账号没有组装单数据。
- Forge 修正：`page_production_assembly_workspace` 补齐横向指标卡、状态标签、搜索框、清空筛选、刷新、分页说明、来源订单/创建日期/创建人列；没有生效 BOM 时显示业务前置提示，未实现的导入/导出不再伪装为可点击操作。
- Forge 浏览器实操：在内置浏览器使用生效 BOM `BOM-RM-CAB-800-V1` 新建并下达 `ASM-2026-0011`，生成领料单 `MAT-2026-0006`，确认并过账，登记生产入库 `WIN-2026-0007`，批次 `FG-BROWSER-20260914`，填写完工说明后确认完工，页面回读状态为已完工。
- 工程证据：`acceptance:production-assembly`、`acceptance:production-assembly-ui-readback`、`acceptance:production-assembly-restart` 已通过。当前库为继续验收补入了本地生产库存材料；这属于 Forge 本地可写执行材料，不属于 RISEMAP 已办理事实。

## 2026-09-14 当前库销售主链回款闭环复核

- RISEMAP 对照状态：内置浏览器登录态可用性待恢复后补实时页面复核；本条只记录 Forge 当前 SQLite 的持久闭环证据，不替代 RISEMAP 同材料页面验收。
- Forge 当前表现：同一当前库中，`SO-CONVERT-20260909-001` 已形成两张销售发票、两条应收、三笔已分配收款，订单、合同、发票、应收、资金账户均回读为 243200 元闭环。
- 可用性结论：验收脚本改为先识别当前库是否已完成回款；若已结清，只核对既有收款、分配、结清状态和重复收款阻断，不再为重复验收生成第二套现金流水。
- 通过证据：`acceptance:sales-current-collection`、`acceptance:sales-current-collection-restart`、`acceptance:sales-current-revenue-final`、`acceptance:sales-current-main-chain-restart` 均通过。
- 待补证据：解锁内置浏览器后，需要重新打开 RISEMAP 销售出库/发货/开票/回款相关页面和 Forge 对应页面，逐项检查主按钮、行按钮、筛选、弹窗、提交反馈和回读状态是否符合实际产品布局和真实可用性。

## 2026-09-14 销售页面控件可用性清理

- 新增验收口径：销售与服务复刻不只核对字段和状态，还必须核对按钮、筛选、页签、弹窗和行操作是否符合真实办理顺序并产生可回读结果。
- 已清理：`page_sales_performance_bank` 中无真实切换内容的页签改为业务视图说明；期间筛选改为真实过滤；“全部业绩/我负责的”保留为真实筛选，其余团队与关注视图改为状态说明。
- 已清理：`page_sales_teams`、`page_goodwill_orders`、`page_sales_leads` 中没有跳转或动作的蓝色链接样式改为普通业务文本；`page_sales_targets` 中无动作的年度按钮改为当前年度说明。
- 验收限制：本轮因电脑锁屏，内置浏览器未能读取 RISEMAP 与 Forge 当前页面；这些改动已通过工程门禁，但仍需解锁后补页面点击、弹窗和回读走查，之后才能写成销售块页面闭环。

### 控件可用性补充检查

- 静态页签清理：通用 CRM/服务列表中没有真实切换逻辑的页签，已改为静态视图说明；只有服务工单的“工单列表 / 服务中 / 已完工”保留为真实可点击筛选。
- 惰性按钮清理：销售与服务相关页面已检查 `button` 元素，未发现无 `onClick` 或表单提交语义的惰性按钮。
- 回归结果：Goodwill 审批发货、CRM 线索转化/跟进/公海领取、服务工单受理/派工/接单/完工/报价/结算/质保的业务验收均通过。

- 新增脚本：`acceptance:sales-service-control-usability` 已加入验收命令，覆盖销售、Goodwill、CRM、服务相关页面的惰性按钮、静态假页签、空点击处理和浏览器原生弹窗检查。
- 组合回归：控件可用性检查、当前库回款闭环、收入确认、当前库主链重启、Goodwill 审批发货、CRM 跟进、公海领取、服务工单后续流转及各自重启回读均通过。


## 2026-09-14 控件布局可用性门禁与预付款退款回归

本轮将复刻页面的判断从“字段和状态能显示”收紧为“控件位置符合业务办理习惯，并且每个可见动作都能点击、提交、反馈和回读”。这条规则已经写入项目级 `AGENTS.md`：主按钮必须放在用户完成当前任务后自然能找到的位置，列表行操作只保留真实可执行动作，未验证或未实现能力不得伪装成灰色按钮、假按钮或点击无反馈控件。

当前代码处理结论：

- 客户预收退款验收改为当前库时间戳材料，解决同一 SQLite 重复验收时资金账户编码唯一约束导致的失败；同一库重复运行现在可以继续证明业务流，而不是被测试材料污染。
- 客户预收链路覆盖订单预收登记、到账确认、冲抵同订单应收、退款申请驳回、退款审批、付款、核销和重复核销阻断。
- 供应商预付款退款链路覆盖采购预付款申请、审批付款、冲抵应付、退款申请驳回、退款审批、到账、核销和重复核销阻断。
- 供应/生产控件可用性静态门禁已经加入，覆盖生产、采购、委外、BOM、交付、待办、收款、供应商退款、出入库和质检相关页面，检查惰性按钮、假页签、空点击处理和浏览器原生弹窗。

本轮通过证据：

- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:customer-prepayment-refund` 通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:customer-prepayment-refund-restart` 通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:prepayment-refund` 通过。
- `FORGE_URL=http://localhost:4321 pnpm --dir apps/forge-objectstack acceptance:prepayment-refund-restart` 通过。
- `pnpm --dir apps/forge-objectstack acceptance:sales-service-control-usability` 通过。
- `pnpm --dir apps/forge-objectstack acceptance:supply-production-control-usability` 通过。
- `pnpm --dir apps/forge-objectstack typecheck` 通过。
- `pnpm --dir apps/forge-objectstack validate` 通过，保留既有 ADR-0065 className 警告。
- `pnpm --dir apps/forge-objectstack build` 通过，保留既有 ADR-0065 className 警告。

当前边界：本轮内置浏览器因本机锁屏和浏览器请求策略未能读取 RISEMAP 与 Forge 当前页面，因此这部分只能证明当前库业务流、重启回读和静态控件门禁通过，不能写成 RISEMAP 同材料页面闭环。解锁后必须重新打开 RISEMAP 销售、服务、供应和生产对应页面，再打开 Forge 同材料页面，逐项核对按钮位置、筛选、弹窗、阻断、反馈、跳转和页面回读。

### 全项目页面控件静态门禁补充

为避免后续复刻页面继续出现“像按钮但不可办”的问题，本轮新增全项目页面控件门禁 `acceptance:page-control-usability`。该检查覆盖 55 个自定义页面，阻断以下问题：无真实点击或提交行为的按钮、空点击处理、静态元素套用交互页签样式、浏览器原生 `alert` / `confirm` / `prompt`。

最新通过证据：

- `pnpm --dir apps/forge-objectstack acceptance:page-control-usability` 通过，55 个自定义页面未发现上述控件缺陷。
- 新增门禁后重新运行 `pnpm --dir apps/forge-objectstack typecheck`、`pnpm --dir apps/forge-objectstack validate`、`pnpm --dir apps/forge-objectstack build`，均通过；`validate` 和 `build` 仍保留既有 ADR-0065 className 警告。

该静态门禁只能证明没有显眼的惰性控件和原生弹框，不能替代真实页面点击。后续每个功能块仍必须用内置浏览器按 RISEMAP 页面和 Forge 页面分别走操作前、弹窗、阻断、提交反馈和回读。

## 2026-09-14 控件可用性与委外一库复验补充

本轮把“页面是否像真实产品一样可用”列入复刻验收约束：页面不能只展示字段和按钮，主按钮必须处在用户办理当前动作时自然寻找的位置；未实现能力应以业务说明呈现，不能伪装成灰色按钮、假页签或点击无反馈的行操作。全项目静态门禁已覆盖 55 个自定义页面，检查无真实点击动作的按钮、空点击处理、只弹 toast 的动作、假链接、假页签、原生浏览器弹框、原生下拉和原生日期输入。

修复了委外回厂与入库验收在当前库重复执行时的两个可用性问题：回厂单号不再固定，避免第二次复验因重复单号失败；委外重启回读不再按空库余额写死，而是按本次来源流水和库存增量核对。这样可以证明同一业务动作对当前库是真实可复验的，不会把累计库存误当本次入库结果。

本轮本地证据：`acceptance:subcontract-one-db-chain`、`acceptance:subcontract-one-db-restart`、`acceptance:page-control-usability`、`acceptance:sales-service-control-usability`、`acceptance:supply-production-control-usability`、`typecheck`、`validate`、`build` 均通过。`validate` 与 `build` 仍保留既有 ADR-0065 `className` 警告，本轮没有扩大处理样式编译策略。

浏览器证据边界：本轮尝试读取内置浏览器时，本机处于锁屏状态且浏览器请求策略未加载成功，因此未能重新打开 RISEMAP 与 Forge 做实时页面点击。按项目规则，本轮只能证明本地工程、API 与持久化回读，不声明 RISEMAP 同材料页面闭环。恢复内置浏览器后，下一步必须按 RISEMAP 当前页面与 Forge 对应页面逐项点击，覆盖入口、主按钮位置、弹窗、输入、提交反馈、状态变化和回读。

## 2026-09-14 当前库可复验修复与全链回归

本轮按“控件布局符合真实产品使用习惯、按钮真实可用、流程可重复办理”的标准复查当前库。发现并修复三类会导致页面或流程看似可用、实际不可复验的问题：

1. 采购主链不再使用固定采购单号，空明细负例也使用本轮单号；供应商已审批时直接验证采购单可提交，供应商未审批时才验证前置审批阻断。
2. 生产组装不再假设当前库已有四类 BOM 物料库存；验收前通过期初入库补齐可办理库存，再验证领料、补料、退料、分批成品入库和完工。
3. 生产拆换不再假设当前库有足够成品库存；验收前补齐可办理成品库存，再验证拆解出库、回收/报废分配、换件领用和旧件回收。
4. 委外一库串联不再使用固定对账单号；回厂、确认入库、NCR、对账、应付可在当前库重复跑通。

本轮通过的当前库回归：销售收款、销售收款重启回读、收入确认最终态、销售主链重启回读、Goodwill 审批发货、Goodwill 重启回读、CRM 后续流转、CRM 重启回读、服务后续流转、服务重启回读、采购主链、采购重启回读、采购到货检验入库、采购入库重启回读、生产组装、生产组装重启回读、生产拆换、生产拆换重启回读、委外一库串联、委外一库重启回读。

本轮工程门禁：全项目页面控件静态门禁、销售/服务控件门禁、供应/生产控件门禁、`typecheck`、`validate`、`build` 均通过。`validate` 和 `build` 仍保留既有 ADR-0065 `className` 警告，本轮未把样式编译治理纳入完成范围。

实时页面对照状态：已再次尝试读取内置浏览器，但本机仍处于锁屏状态，浏览器请求策略也未加载成功。因此本轮没有实时打开 RISEMAP 页面和 Forge 页面，不能宣称 RISEMAP 同材料页面闭环。下一步恢复浏览器后，必须以本轮同一组业务材料逐页点击销售、Goodwill、CRM、服务、采购、生产和委外页面，重点检查主按钮位置、行操作、弹窗、输入阻断、提交反馈、状态变化和页面回读。

## 2026-09-14 页面控件真实可用性规则补强

本轮根据现场复刻反馈，把页面判断从“结构存在、字段可见”继续收紧到“用户能按真实业务习惯完成办理”。项目级 `AGENTS.md` 已补充要求：控件名称必须说明业务动作，位置要贴合当前办理步骤，点击后必须进入可理解的表单、确认、状态变化或下一步；当前不能办理的能力只能作为业务说明或空态引导展示，不得包装成按钮、页签、筛选或行操作。

工程门禁同步扩大：`acceptance:page-control-usability` 继续覆盖 55 个自定义页面，阻断无动作按钮、假链接、假页签、原生弹窗、原生下拉/日期输入、空点击和只吐提示不办事的控件；`acceptance:page-visible-language` 已从自定义页面扩大到 104 个产品源码文件，覆盖页面、对象、动作和配置定义，防止标准对象页或动作面板继续露出工程验收口吻。本轮据此把项目外部观察证据、身份映射和图纸业务关联中的可见“待复核”改为业务语言“待确认/需确认”。

本轮已通过：控件可用性门禁、可见文案门禁、销售服务控件门禁、供应生产控件门禁、`pnpm typecheck`、`pnpm validate`、`pnpm build`。内置浏览器当前被本机锁屏和浏览器策略阻断，未能重新打开 RISEMAP 与 Forge 做实时点击回读，因此本节只证明源码和工程门禁已经收紧，不能替代两侧页面办理验收。

## 2026-09-14 销售发货控件布局与真实可用性修正

本轮重新打开 RISEMAP 当前销售发货单页面 `https://risemap.cn/sales/outbound` 和 Forge 当前销售发货单页面 `http://localhost:4321/_console/apps/forge/page/page_sales_shipment_workspace` 做实时对照。RISEMAP 当前事实：销售发货单列表包含“下一步操作 待出库发货单”“新建发货单”“导出”“导出任务”“刷新”“状态”“范围”，列表列为发货单号、关联订单、客户单号、客户名称、收货人、状态、出库进度、含税金额、出库单、出库日期、操作；进入新建时跳转到独立新建页，页面按基本信息、商品明细、备注、附件、操作提示组织，先选择客户，再从该客户销售订单中勾选来源订单。

发现的 Forge 差异：Forge 原新建发货单虽然可提交，但直接从“客户订单”开始选择，缺少客户先行、订单随客户过滤、商品明细预览和附件分区；默认发货单号按日期生成，连续使用存在重复风险。这属于控件布局和人类办理习惯差异，不只是样式差异。

已修正 Forge 页面：新建发货单入口仍保留在列表主操作区，点击后进入可办理弹窗；弹窗按“基本信息、收货信息、商品明细、备注、附件、操作提示”组织；客户选择提前，关联销售订单按客户过滤；商品明细显示物料编码、名称、订单数量、已建发货和本次发货；附件能力当前以业务说明呈现，不做成不可用上传按钮；默认发货单号和出库单号改为带时间戳，避免连续办理重复。

页面可用性证据：内置浏览器中 Forge 点击“新建发货单”后进入表单，点击“下一步”进入“确认创建销售发货单”，点击“确认提交”后页面提示“销售发货单已创建”；刷新后列表从 6 条变为 7 条，并出现 `DN-FORGE-20260913173455`，状态 `待发货`，操作列出现真实“确认发货”。点击“确认发货”后进入出库表单，再进入“确认销售发货出库”；首次因库存不足被阻断并提示“可用库存不足，无法创建出库单”。随后通过当前库期初入库补足同一物料 2 台，再在同一页面确认提交，页面提示“销售出库单已创建”；刷新后该单状态变为 `已出库`，出库进度 `2 / 2 台`，出库单号 `OUT-FORGE-20260913173516`。

本轮证据文件：`docs/references/risemap-capture/live/20260914-sales-shipment-usability/risemap-sales-outbound-new.ax.txt`、`risemap-sales-outbound-new.png`、`forge-sales-shipment-after-ui-submit.ax.txt`、`forge-sales-shipment-after-ui-submit.png`。

## 2026-09-14 服务工单页面可用性补验

- 本轮实际打开 RISEMAP：`https://risemap.cn/after-sales/orders`、`https://risemap.cn/after-sales/orders/new`。
- 本轮实际打开 Forge：`http://localhost:4321/_console/apps/forge/page/page_service_orders`、`http://localhost:4321/_console/apps/forge/page/page_service_orders?mode=new`。
- RISEMAP 基线：服务工单从销售分类的服务管理分组进入；新建服务工单是独立办理页，按服务需求、客户与产品、质保信息、费用与报价、问题 / 服务内容填写，底部可取消、保存草稿、提交工单。
- Forge 修正：将 `新建服务工单` 从浏览器点击无反应的工具栏按钮改为可达页面入口，新建页按同样办理顺序展示字段；提交前走标准确认弹窗。
- Forge 浏览器实操：同一工单 `WO-FORGE-20260914014356` 已从新建提交跑到待受理、待分派、待接单、服务中、已完工，并继续生成服务报价、服务结算和质保卡。列表状态、下一步、工程师、客户、订单和承接按钮均回写。
- 当前结论：服务工单页面达到“控件位置符合办理习惯、主按钮可用、行操作可推进状态”的本地页面可用性要求；后续服务报价单、服务结算单、质保管理、派工中心还需逐页用同方法复查。

## 2026-09-14 服务报价单页面可用性补验

- 本轮实际打开 RISEMAP：`https://risemap.cn/after-sales/quotations`、`https://risemap.cn/after-sales/quotations/new`。
- 本轮实际打开 Forge：`http://localhost:4321/_console/apps/forge/page/page_service_quotations`。
- RISEMAP 基线：服务报价单列表提供 `新增服务报价单`，新建页按关联服务工单、报价清单、报价条款办理，底部可保存草稿或保存并发送。
- Forge 浏览器实操：报价单 `SQ-20260913174536` 从草稿确认到已确认，再转结算并回写 `已转结算`。
- 当前结论：服务报价单的确认和转结算行操作已验证可用；直接新增服务报价单页面尚未复刻，当前页面用业务说明明确从已完工服务工单生成报价，不再展示伪入口。

## 2026-09-14 服务结算单页面可用性补验

本轮重新打开 RISEMAP 服务结算单页面和 Forge 服务结算单页面，按“按钮是否符合实际办理习惯并真实可用”复查服务结算到财务应收的承接。

RISEMAP 当前事实：`https://risemap.cn/after-sales/settlements` 的服务结算单列表当前为空，主入口为 `从完工工单新建`，点击后进入服务工单列表选择来源；页面职责是服务费用核算、审批、客户确认与财务应收衔接。

Forge 修正结果：`page_service_settlements` 保留从完工工单或已确认报价生成结算的业务说明，列表行操作支持 `确认结算` 和 `生成应收`。本轮发现 `SS-20260913174545` 生成应收时会因负责人为空失败，已修正为用结算负责人或当前操作人补齐应收负责人，避免用户进入无法修正的死路。

浏览器实操结果：在 Forge 页面点击 `SS-20260913174545` 的 `生成应收`，进入 `生成服务应收` 二次弹窗；点击 `确认生成应收` 后页面提示 `服务应收已生成`，列表回读状态为 `已生成应收`，财务应收号为 `AR-SVC-20260913175350`。

本轮通过证据：`acceptance:page-control-usability`、`acceptance:sales-service-control-usability`、`acceptance:page-visible-language`、`typecheck`、`validate`、`build`、`acceptance:sales-service-followup-flow`、`acceptance:sales-service-followup-restart` 均通过。`validate` 和 `build` 仍保留既有 ADR-0065 `className` 警告。

当前边界：服务工单、服务报价、服务结算的 Forge 本地可写链路已完成页面实操和重启回读；RISEMAP 线上服务工单提交仍因现场图片上传未执行而停在待附件复核，服务报价和服务结算当前线上缺少可办理终态数据，因此不能把 Forge 本地终态写成 RISEMAP 线上同材料终态。

## 2026-09-14 派工中心与接单中心页面可用性补验

本轮继续按“控件位置符合真实产品使用习惯，并且按钮真实可用”的标准检查服务管理分入口。

RISEMAP 当前事实：`https://risemap.cn/after-sales/dispatch` 是待分派调度工作台，包含待分派、派工日历、资源负载、SLA 监控、地区/类型/紧急度筛选、全选本页和批量派工；无待分派工单时批量派工禁用。接单中心从 RISEMAP 菜单进入后为 `https://risemap.cn/after-sales/my-workspace`，是服务人员工作台，包含今日计划、待接单、进行中、今日已完工、超时工单，以及今日、我的工单、业绩、我的备件、我的报价单、我的结算单视图。

Forge 修正结果：`page_service_dispatch` 不再显示已完成工单作为派工待办，默认只展示待分派工单，指标按当前数据计算，行操作提供真实派工弹窗；`page_service_workspace` 默认只展示待接单和服务中工单，接单和提交服务结果都通过标准弹窗办理，已完工记录不再挤占主办列表。

浏览器实操结果：`WO-DISPATCH-20260913180046` 在 Forge 派工中心点击 `派工` 后成功进入待接单并从待分派列表移除；同一类待接单材料在 Forge 接单中心点击 `接单` 后进入服务中，再点击 `提交服务结果` 后提示 `服务工单已完工`，从可办列表移除。

当前边界：派工中心和接单中心的单工单办理路径已经页面可用；RISEMAP 的批量派工、派工日历、资源负载、SLA 监控，以及接单中心的备件、报价、结算子视图仍只记录入口事实，尚未做完整同材料终态办理。

## 2026-09-14 质保管理页面可用性补验

本轮继续检查服务管理末端的质保管理页面。

RISEMAP 当前事实：`https://risemap.cn/after-sales/warranty` 是质保台账和预警概览页，包含概览、质保卡、质保规则，首屏指标包括生效中、待激活、宽限期、已过保、已终止；当前线上账号各项为 0，并显示最快到期质保卡和高频返修产品空态。

Forge 修正结果：`page_warranty_management` 的质保指标不再写死为 0，而是按当前质保卡状态计算；本地当前库已有质保卡时，页面显示 `生效中 20`。没有实现延保、终止、激活等页面动作前，不再保留无意义操作列。

当前边界：质保台账读数和列表可读性已修正；质保规则、延保、终止、激活等动作仍只记录入口事实，尚未完成 RISEMAP 同材料终态办理。

## 2026-09-14 服务分析与服务配置可用性补验

本轮按“控件是否符合真实产品布局和人类使用习惯、按钮是否真的可用”继续复查服务管理剩余入口，并重新打开 RISEMAP 当前页面对照。

- RISEMAP 服务分析：`https://risemap.cn/after-sales/stats`，当前页面是经营分析看板，包含时间、地区、团队、计费、类型、紧急度筛选，支持售后主管、工程师、财务视角，并按服务人员、客户、工单类型、时间、区域查看分组结果。
- RISEMAP 服务配置：`https://risemap.cn/after-sales/config`，当前页面按工单类型、状态与紧急度、质保规则、SLA 规则、费用类型、付款模板、服务人员、报价设置、客户门户分组，并提供新增、编辑、停用、删除配置动作。
- Forge 已修正：`page_service_analysis` 不再展示失真的分析列和空操作列，改为当前库真实汇总页，支持按服务类型、客户、工程师切换；`page_service_config` 不再伪造配置维护动作，分类切换变成真实可点击控件，空态按当前分类展示业务说明。
- 内置浏览器已验证：Forge 服务分析能打开并显示当前库 `25` 条工单、`¥136,000.00` 服务收入、`¥142,800.00` 报价金额、`21` 张质保卡；点击“按客户”和“按工程师”后表格维度随之变化。Forge 服务配置能打开并在“服务人员”“质保规则”等分类之间切换，未出现空操作列或不可办的新增/编辑/删除按钮。
- 证据目录：`docs/references/risemap-capture/live/20260914-service-analysis-config-usability/`。

当前边界：Forge 服务配置本轮只作为配置核对页通过可用性验收；RISEMAP 已观察到的配置新增、编辑、停用、删除维护动作尚未在 Forge 复刻，后续需要单独建立配置维护合同并实现二次确认、状态回读和重启回读。

## 2026-09-14 销售主链当前库闭环复核

本轮回到完整目标复核当前 SQLite 下的销售主链，不把页面结构或单个接口成功当成闭环。当前 `http://localhost:4321` 服务和 `apps/forge-objectstack/.objectstack/data/objectstack.db` 下，客户、联系人、报价、合同、订单、发货、出库、开票、收款和收入确认已经可以连续回读。

- 销售主链重启回读通过：`apps/forge-objectstack/.objectstack/acceptance/sales-current-main-chain-restart-report.json` 证明同一订单 `kn0edpSF78YcsGcJ`、合同 `Qeo4FBs0c6w_Nwzd`、资金账户 `9AabTu3JYpfv8a3q` 在当前库中保持 `shipped`、开票已结清、应收已结清、3 笔收款分配、2 笔收入确认，金额 `243200`。
- 收款闭环通过：`sales-current-collection-report.json` 和 `sales-current-collection-restart-report.json` 证明两张应收、两张发票、3 笔收款分配、订单和合同回款金额、账户余额均在当前库和重启后保持一致，并阻断已结清应收的重复收款。
- 收入确认通过：`sales-current-revenue-final-report.json` 证明两笔销售出库来源均已形成并审批收入确认，订单已确认收入 `243200`；一条历史驳回记录保留为可追溯记录，不影响当前终态。
- 销售管理数据通过：`sales-management-data-report.json` 证明销售团队、销售目标、Goodwill 订单保留客户、负责人和业务状态；`金一涛` 与 `Dev Admin` 继续按同一业务用户对照。
- Goodwill 后续通过：`sales-goodwill-flow-report.json` 和 `sales-goodwill-flow-restart-report.json` 证明 Goodwill 订单能创建、提交、审批、发货并完成，且重启后保持 `completed`、发货数量 `2`。
- CRM 后续通过：`sales-crm-followup-flow-report.json` 和 `sales-crm-followup-restart-report.json` 证明线索转客户和商机、商机跟进推进、公海客户领取均可回读并经重启保持。
- 服务后续通过：`sales-service-followup-flow-report.json` 和 `sales-service-followup-restart-report.json` 证明服务工单从创建、受理、派工、接单、完工，到服务报价、服务结算、应收和质保卡均可回读并经重启保持。

本轮重新执行的门禁包括：`acceptance:sales-management-data`、`acceptance:sales-current-collection`、`acceptance:sales-current-collection-restart`、`acceptance:sales-current-revenue-final`、`acceptance:sales-current-main-chain-restart`、`acceptance:sales-goodwill-flow`、`acceptance:sales-goodwill-flow-restart`、`acceptance:sales-crm-followup-flow`、`acceptance:sales-crm-followup-restart`、`acceptance:sales-service-followup-flow`、`acceptance:sales-service-followup-restart`。

当前边界：以上证明的是 Forge 当前 SQLite 本地闭环和重启回读。RISEMAP 同材料终态仍按页面逐项补证；服务配置维护的新增、编辑、停用、删除动作仍未在 Forge 复刻，当前只作为配置核对页通过可用性验收。
