# RISEMAP 产品结构基线

更新于 2026-09-12。本基线从 `docs/risemap/verticals` 的 RM 入口清单生成，记录当前账号已发现的产品结构。它是导航与页面范围证据，不代表每个入口都已完成深度业务验证。

## 总体结构

| 一级职能域 | 二级功能组 | 已发现入口 | 证据状态 |
| --- | ---: | ---: | --- |
| 工作台 | 1 | 4 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 供应链 | 6 | 41 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 销售 | 2 | 19 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 生产 | 3 | 29 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 项目 | 1 | 5 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 行政 | 5 | 32 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 财务 | 3 | 18 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 报表 | 2 | 11 | 首屏入口已盘点；深度状态以各功能工作簿为准 |
| 系统 | 2 | 22 | 首屏入口已盘点；深度状态以各功能工作簿为准 |

合计 9 个一级职能域、25 个二级功能组、181 个已发现入口。RM 编号覆盖 `RM-099` 至 `RM-004`，实际展示顺序按职能域而非编号排序。

## 产品结构

### 工作台

#### 工作台

证据工作簿：[risemap/verticals/workbench/workbench.md](risemap/verticals/workbench/workbench.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-001 | 工作台 | `/` |
| RM-002 | AI 广场 | `/ai` |
| RM-003 | 引导中心 | `/onboarding` |
| RM-004 | 待办管理 | `/todos` |

### 供应链

#### 到货检验

证据工作簿：[risemap/verticals/supply-chain/arrival-inspection.md](risemap/verticals/supply-chain/arrival-inspection.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-005 | 到货通知 | `/inventory/arrival-notices` |
| RM-006 | 到货登记 | `/inventory/arrival` |
| RM-007 | 待检验库存 | `/inventory/pending-inspection` |
| RM-008 | 检验单 | `/inventory/inspection` |
| RM-009 | 检验规则 | `/inventory/inspection-rules` |

#### 入库管理

证据工作簿：[risemap/verticals/supply-chain/inbound.md](risemap/verticals/supply-chain/inbound.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-024 | 全部入库单 | `/inventory/inbound` |
| RM-025 | 采购入库 | `/inventory/inbound/purchase` |
| RM-026 | 生产入库 | `/inventory/inbound/production` |
| RM-027 | 其他入库 | `/inventory/inbound/other` |
| RM-028 | 期初入库 | `/inventory/inbound/opening` |
| RM-029 | 入库明细 | `/inventory/inbound/details` |

#### 库存管理

证据工作簿：[risemap/verticals/supply-chain/inventory.md](risemap/verticals/supply-chain/inventory.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-030 | 库存总览 | `/inventory/overview` |
| RM-031 | 不合格处理 | `/inventory/ncr` |
| RM-032 | 库存流水 | `/inventory/flow` |
| RM-033 | 库存锁定 | `/inventory/lock` |
| RM-034 | 库存盘点 | `/inventory/check` |
| RM-035 | 调拨与借出 | `/inventory/transfer` |
| RM-036 | 库存预警 | `/inventory/alerts` |
| RM-037 | 报损单 | `/inventory/damage` |
| RM-038 | SN码管理 | `/inventory/sn-verify` |

#### 基础资料

证据工作簿：[risemap/verticals/supply-chain/master-data.md](risemap/verticals/supply-chain/master-data.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-010 | 物料管理 | `/base/products` |
| RM-011 | 物料组合 | `/base/product-bundles` |
| RM-012 | BOM管理 | `/base/bom` |
| RM-013 | 综合物料搜索 | `/base/material-search` |
| RM-014 | 供应商管理 | `/base/suppliers` |
| RM-015 | 产品实例追溯 | `/base/barcode-center` |
| RM-016 | 仓库管理 | `/base/warehouses` |

#### 出库管理

证据工作簿：[risemap/verticals/supply-chain/outbound.md](risemap/verticals/supply-chain/outbound.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-039 | 出库单列表 | `/inventory/outbound` |
| RM-040 | 生产出库 | `/inventory/outbound/production` |
| RM-041 | 其他出库 | `/inventory/outbound/other` |
| RM-042 | 销售直接出库 | `/inventory/outbound/sales-direct` |
| RM-043 | 待出库发货单 | `/inventory/outbound/shipments` |
| RM-044 | 采购退换货出库 | `/inventory/outbound/purchase-returns` |
| RM-045 | 出库明细 | `/inventory/outbound/details` |

#### 采购管理

证据工作簿：[risemap/verticals/supply-chain/purchasing.md](risemap/verticals/supply-chain/purchasing.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-017 | 采购发票 | `/purchase/invoices` |
| RM-018 | 采购申请 | `/purchase/requests` |
| RM-019 | 采购待办池 | `/purchase/pending-pool` |
| RM-020 | 询价管理 | `/purchase/rfq` |
| RM-021 | 采购订单 | `/purchase/orders` |
| RM-022 | 采购退换货 | `/purchase/returns` |
| RM-023 | 供应商价格本 | `/purchase/pricebook` |

### 销售

#### CRM客户管理

证据工作簿：[risemap/verticals/sales/crm.md](risemap/verticals/sales/crm.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-057 | 客户管理 | `/base/customers` |
| RM-058 | 联系人管理 | `/base/contacts` |
| RM-059 | 销售报价 | `/sales/quotations` |
| RM-060 | 客户物料对照 | `/base/customer-materials` |
| RM-061 | 商机管理 | `/sales/opportunities` |
| RM-062 | 线索管理 | `/sales/leads` |
| RM-063 | 跟进记录 | `/sales/follow-ups` |
| RM-064 | 公海客户 | `/sales/public-sea` |

#### 销售业务

证据工作簿：[risemap/verticals/sales/sales-operations.md](risemap/verticals/sales/sales-operations.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-046 | 框架销售合同 | `/sales/contracts` |
| RM-047 | 销售订单 | `/sales/orders` |
| RM-048 | 收款流水 | `/sales/collection-flow` |
| RM-049 | 销售发货单 | `/sales/outbound` |
| RM-050 | 销售退货 | `/sales/returns` |
| RM-051 | 业绩银行 | `/sales/performance-bank` |
| RM-052 | 价格策略 | `/sales/pricing` |
| RM-053 | Goodwill订单 | `/sales/goodwill` |
| RM-054 | 销售团队 | `/sales/organization` |
| RM-055 | 销售目标 | `/sales/target` |
| RM-056 | 销售发票 | `/sales/invoices` |

### 生产

#### 组装业务管理

证据工作簿：[risemap/verticals/production/assembly.md](risemap/verticals/production/assembly.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-065 | 组装单 | `/production/assembly` |
| RM-066 | 缺料待办 | `/production/shortages` |
| RM-067 | 领料单 | `/production/requisitions` |
| RM-068 | 补料单 | `/production/material-supplies` |
| RM-069 | 退料单 | `/production/material-returns` |
| RM-070 | 拆解单 | `/production/disassembly` |
| RM-071 | 换件单 | `/production/rework` |

#### 图纸管理

证据工作簿：[risemap/verticals/production/drawings.md](risemap/verticals/production/drawings.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-072 | 进入图纸管理上手指南 | `/drawing/guide` |
| RM-073 | 图纸总览 | `/drawing/overview` |
| RM-074 | 图号档案 | `/drawing/archives` |
| RM-075 | 图纸评审 | `/drawing/reviews` |
| RM-076 | 图纸发布 | `/drawing/releases` |
| RM-077 | 图纸变更 | `/drawing/changes` |
| RM-078 | 图纸发放记录 | `/drawing/distribution` |
| RM-079 | 图纸关联查询 | `/drawing/association` |
| RM-080 | 客户图纸 | `/drawing/customer` |

#### 委外管理

证据工作簿：[risemap/verticals/production/subcontracting.md](risemap/verticals/production/subcontracting.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-081 | 进入委外管理上手指南 | `/subcontract/guide` |
| RM-082 | 委外看板 | `/subcontract` |
| RM-083 | 委外订单 | `/subcontract/orders` |
| RM-084 | 委外发料 | `/subcontract/issues` |
| RM-085 | 委外回厂 | `/subcontract/receives` |
| RM-086 | 委外退料 | `/subcontract/returns` |
| RM-087 | 委外对账 | `/subcontract/reconciliation` |
| RM-088 | 委外供应商 | `/subcontract/suppliers` |
| RM-089 | 委外库存 | `/inventory/subcontract-stock` |
| RM-090 | 批次追溯 | `/subcontract/traces` |
| RM-091 | 委外未交 | `/subcontract/reports/undelivered` |
| RM-092 | 委外进货 | `/subcontract/reports/receipts` |
| RM-093 | 委外对账单 | `/subcontract/reports/reconciliation-statement` |

### 项目

#### 项目管理

证据工作簿：[risemap/verticals/projects/project-management.md](risemap/verticals/projects/project-management.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-094 | 项目中心 | `/project/list` |
| RM-095 | 项目分析中心 | `/project/analytics` |
| RM-096 | 任务管理 | `/project/tasks` |
| RM-097 | 工时管理 | `/project/timesheet` |
| RM-098 | 项目配置中心 | `/project/settings` |

### 行政

#### 审批中心

证据工作簿：[risemap/verticals/administration/approval.md](risemap/verticals/administration/approval.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-099 | 我的审批 | `/workflow/approval-center` |
| RM-100 | 抄送我的 | `/workflow/cc-to-me` |
| RM-101 | 我发起的 | `/workflow/my-instances` |
| RM-102 | 行政申请 | `/workflow/admin-applications` |

#### 考勤假期

证据工作簿：[risemap/verticals/administration/attendance.md](risemap/verticals/administration/attendance.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-122 | 加班申请 | `/hr/overtime` |
| RM-123 | 请假管理 | `/hr/leave` |
| RM-124 | 出差申请 | `/hr/business-trip` |
| RM-125 | 考勤管理 | `/hr/attendance` |
| RM-126 | 考勤统计 | `/hr/stats-dashboard` |

#### 人力资源

证据工作簿：[risemap/verticals/administration/hr.md](risemap/verticals/administration/hr.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-115 | 人事工作台 | `/hr/workbench` |
| RM-116 | 员工档案 | `/hr/employees` |
| RM-117 | 招聘管理 | `/hr/recruitment` |
| RM-118 | 入职离职 | `/hr/onboarding` |
| RM-119 | 薪酬福利 | `/hr/compensation` |
| RM-120 | 规章制度 | `/hr/policies` |
| RM-121 | 通讯录 | `/hr/contacts` |

#### 行政管理

证据工作簿：[risemap/verticals/administration/office.md](risemap/verticals/administration/office.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-103 | 公司通知 | `/ops/notices` |
| RM-104 | 用章管理 | `/ops/seals` |
| RM-105 | 会议纪要 | `/ops/meetings` |
| RM-106 | 工作汇报 | `/ops/reports` |
| RM-107 | 文档中心 | `/ops/docs` |
| RM-108 | 固定资产 | `/ops/assets` |
| RM-109 | 资质与申报 | `/ops/certificates` |
| RM-110 | 物料领取 | `/ops/materials` |
| RM-111 | 设备维护 | `/ops/equipment-maintenance` |
| RM-112 | 礼品管理 | `/ops/gift/apply` |
| RM-113 | 借出管理 | `/ops/lending` |
| RM-114 | 车辆管理 | `/ops/vehicles` |

#### 流程中心

证据工作簿：[risemap/verticals/administration/workflow.md](risemap/verticals/administration/workflow.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-127 | 审批记录 | `/workflow/records` |
| RM-128 | 发起流程 | `/workflow/start` |
| RM-129 | 流程定义 | `/workflow/definition` |
| RM-130 | 流程分类 | `/workflow/category` |

### 财务

#### 业务确认

证据工作簿：[risemap/verticals/finance/business-confirmation.md](risemap/verticals/finance/business-confirmation.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-139 | 销售收入确认 | `/finance/revenue-recognition` |
| RM-140 | 成本中心 | `/finance/cost-center` |
| RM-141 | 费用中心 | `/finance/expense-center` |
| RM-142 | 报销管理 | `/finance/reimbursement` |
| RM-143 | 对账单 | `/finance/reconciliations` |

#### 资金管理

证据工作簿：[risemap/verticals/finance/funds.md](risemap/verticals/finance/funds.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-131 | 资金账户 | `/finance/bank-accounts` |
| RM-132 | 资金流水 | `/finance/bank-flow` |
| RM-133 | 应收应付 | `/finance/accounts` |
| RM-134 | 收款管理 | `/finance/payment-collections` |
| RM-135 | 付款管理 | `/finance/payment-writeoffs` |
| RM-136 | 退款申请 | `/finance/refunds` |
| RM-137 | 授信额度管理 | `/finance/credit-management` |
| RM-138 | 借款贷款管理 | `/finance/loans` |

#### 发票管理

证据工作簿：[risemap/verticals/finance/invoices.md](risemap/verticals/finance/invoices.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-144 | 发票总览 | `/finance/invoices/overview` |
| RM-145 | 销项发票 | `/finance/invoices/sales` |
| RM-146 | 进项发票 | `/finance/invoices/purchase` |
| RM-147 | 开票任务 | `/finance/invoices/tasks` |
| RM-148 | 调整记录 | `/finance/invoices/adjustments` |

### 报表

#### 报表

证据工作簿：[risemap/verticals/reports/business-reports.md](risemap/verticals/reports/business-reports.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-149 | 销售统计 | `/reports/sales` |
| RM-150 | 采购统计 | `/reports/purchase` |
| RM-151 | 库存统计 | `/reports/inventory` |
| RM-152 | 项目统计 | `/reports/project` |
| RM-153 | 组装统计 | `/reports/assembly` |

#### 财务统计

证据工作簿：[risemap/verticals/reports/financial-reports.md](risemap/verticals/reports/financial-reports.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-154 | 财务总览 | `/finance/statistics/overview` |
| RM-155 | 损益分析 | `/finance/statistics/profit` |
| RM-156 | 资金分析 | `/finance/statistics/capital` |
| RM-157 | 往来账款 | `/finance/statistics/current-account` |
| RM-158 | 税务库存 | `/finance/statistics/budget-tax` |
| RM-159 | 风险监控 | `/finance/statistics/risk` |

### 系统

#### 业务设置

证据工作簿：[risemap/verticals/system/business-settings.md](risemap/verticals/system/business-settings.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-165 | 商品管理 | `/settings/business/product` |
| RM-166 | 财务配置 | `/settings/business/finance` |
| RM-167 | 行政管理 | `/settings/business/office` |
| RM-168 | 客户管理 | `/settings/business/customer` |
| RM-169 | 采购销售 | `/settings/business/sales` |
| RM-170 | 库存管理 | `/settings/business/inventory` |
| RM-171 | 其他配置 | `/settings/business/other` |
| RM-172 | 人事配置 | `/settings/business/hr` |
| RM-173 | 项目管理 | `/settings/business/project` |
| RM-174 | 图纸配置 | `/settings/business/drawing` |
| RM-175 | 生产配置 | `/settings/business/production` |
| RM-176 | 委外配置 | `/settings/business/subcontract` |
| RM-177 | 单据打印 | `/settings/business/print` |
| RM-178 | 插件中心 | `/settings/plugins` |
| RM-179 | 服务订阅 | `/service-subscription` |
| RM-180 | 推广奖励 | `/referral` |
| RM-181 | 字段管理 | `/settings/fields` |

#### 系统设置

证据工作簿：[risemap/verticals/system/system-settings.md](risemap/verticals/system/system-settings.md)

| 编号 | 入口 | 路由 |
| --- | --- | --- |
| RM-160 | 基础配置 | `/settings` |
| RM-161 | 用户与角色 | `/settings/accounts` |
| RM-162 | 部门管理 | `/settings/departments` |
| RM-163 | 用户会话 | `/settings/sessions` |
| RM-164 | 审计日志 | `/settings/audit-log` |

## 页面类型和产品关系

| 类型 | 典型入口 | 在产品中的责任 |
| --- | --- | --- |
| 工作台 / 看板 | 工作台、库存总览、委外看板、人事工作台、财务总览 | 聚合岗位待办、阶段指标、异常和快捷入口 |
| 业务主单据 | 销售订单、采购订单、组装单、委外订单、对账单 | 保存业务承诺、状态、责任、金额数量和上下游关系 |
| 执行单据 | 到货登记、检验单、发料、回厂、入出库、收付款 | 完成一个受控业务动作，并产生可追溯结果 |
| 主数据 | 客户、供应商、物料、仓库、员工 | 为业务单据提供可用且受权限约束的引用 |
| 异常中心 | 不合格处理、退换货、报损、风险监控 | 承接正常主链不能直接消化的偏差和责任 |
| 统计报表 | 销售、采购、库存、项目、组装和财务统计 | 以已入账业务记录形成口径明确的分析 |
| 配置中心 | 系统设置、业务设置、流程定义 | 维护组织、权限、字典、规则、模板和集成 |
| 指南 / 引导 | 引导中心、图纸/委外指南 | 按岗位解释准备条件、任务顺序、阻断与常见问题 |

## 岗位入口原则

- 一级职能域稳定存在，具体菜单、记录范围、字段和动作按角色收敛。
- 工作台和看板先显示本人的待办、异常和即将逾期，再提供全量查询。
- 明细行、日志、流水和关系对象属于主单据详情或审计页签，不成为日常导航。
- 同一业务记录从任何入口打开时，单号、状态、来源、结果和下一步保持一致。
- 当前证据没有证明的角色差异继续标记为待验证，不从管理员视图外推。

## 证据边界

- 181 是当前试用空间中已发现的入口总数，不代表厂商全部租户、付费模块或后台能力。
- 每个入口的首屏已经盘点，但大量新建、状态变化、权限、异常与下游影响仍未验证。
- 复刻可观察产品行为，不声称还原 RISEMAP 内部源码、数据模型或部署方式。
- Forge 可以增加 OEM 扩展能力，但必须标出来源，并放在不破坏上述默认结构的位置。
