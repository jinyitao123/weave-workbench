# 供应链 / 出库管理

当前发现 7 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-039 | 出库单列表 | `https://risemap.cn/inventory/outbound` | 出库单列表 | 导出、刷新、业务类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/214-rm-039-loaded.png) | 首屏已采集，流程未验证 |
| RM-040 | 生产出库 | `https://risemap.cn/inventory/outbound/production` | 生产出库 | 下一步操作 生产入库、导出、刷新、出库类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/216-rm-040-loaded.png) | 首屏已采集，流程未验证 |
| RM-041 | 其他出库 | `https://risemap.cn/inventory/outbound/other` | 其他出库 | 新建其他出库、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/218-rm-041-loaded.png) | 首屏已采集，流程未验证 |
| RM-042 | 销售直接出库 | `https://risemap.cn/inventory/outbound/sales-direct` | 销售直接出库 | 刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/220-rm-042-loaded.png) | 首屏已采集，流程未验证 |
| RM-043 | 待出库发货单 | `https://risemap.cn/inventory/outbound/shipments` | 待出库发货单 | 下一步操作 出库单列表、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/222-rm-043-loaded.png) | 首屏已采集，流程未验证 |
| RM-044 | 采购退换货出库 | `https://risemap.cn/inventory/outbound/purchase-returns` | 采购退换货出库 | 刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/224-rm-044-loaded.png) | 首屏已采集，流程未验证 |
| RM-045 | 出库明细 | `https://risemap.cn/inventory/outbound/details` | 出库明细 | 刷新、业务类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/226-rm-045-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0147 | RM-039 | 第一遍列表 | 打开全部出库单列表 | 统一管理出库单和待出库发货单，显示关联单号、销售/客户单号、往来单位、物料、仓库、日期、物流、收入确认、操作员与状态 | 确认出库主表同时承担订单来源、物流执行和收入确认的交叉追踪 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-039/603-rm-039-all-outbound-list.png) |
| DR-0148 | RM-039 | 第一遍筛选 | 展开业务类型筛选 | 业务类型包含销售出库、生产领料、采购退货、其他出库、生产出库、委外出库、销售直接出库 | 确认统一出库台账的来源枚举，后续各专用页面应汇聚到同一出库实体 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-039/604-rm-039-business-type-filter.png) |
| DR-0149 | RM-039 | 第一遍筛选 | 展开出库状态筛选 | 状态包含待出库、已出库、已签收 | 确认物流状态至少分出库执行与收货确认两阶段，不能用一次扣库代替签收 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-039/605-rm-039-status-filter.png) |
| DR-0150 | RM-040 | 第一遍列表 | 打开生产出库 | 生产出库沿用统一出库字段并提供下一步“生产入库”入口，可按出库类型与状态筛选 | 确认生产出库是生产领料/退料等制造侧库存动作，并与完工入库形成前后衔接 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-040/606-rm-040-production-outbound-list.png) |
| DR-0151 | RM-040 | 第一遍筛选 | 展开生产出库类型 | 生产出库类型为组装出库与委外出库 | 确认自制组装领料和委外发料共用生产出库台账，但需保留类型区分 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-040/607-rm-040-production-outbound-types.png) |
| DR-0152 | RM-041 | 第一遍列表 | 打开其他出库 | 其他出库列表显示单号、类型、物料、日期、状态、原因和创建人，并提供手工新建入口 | 确认非订单型库存消耗通过独立原因与创建人留痕 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/608-rm-041-other-outbound-list.png) |
| DR-0153 | RM-041 | 第一遍表单 | 打开新建其他出库单 | 流程为草稿、待审批、已审批、已出库；类型来自业务配置且当前无启用项；可选往来单位、原因、Excel 导入/任务/手工物料，默认快递并支持附件 | 确认其他出库需先配置类型，审批和实际出库分离，支持批量明细与证据附件 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/609-rm-041-other-outbound-form.png) |
| DR-0154 | RM-041 | 第一遍往来单位 | 展开往来单位类型 | 可选客户或供应商作为其他出库往来单位 | 确认其他出库可覆盖客户样品/赠品和供应商委托等多方场景 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/610-rm-041-counterparty-types.png) |
| DR-0155 | RM-041 | 第一遍发货方式 | 切换为物流 | 物流方式要求物流公司、物流单号、联系人，可填电话和地址 | 确认大件/整车物流必须手工登记承运与运单追踪信息 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/611-rm-041-shipping-logistics.png) |
| DR-0156 | RM-041 | 第一遍发货方式 | 切换为客户自取 | 客户自取切换到对应提货信息表单 | 确认自取无需承运单但应保留提货人与交接信息 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/612-rm-041-shipping-self-pickup.png) |
| DR-0157 | RM-041 | 第一遍发货方式 | 切换为本公司送货 | 送货方式切换到内部送货信息表单 | 确认自配送需要独立于快递/物流记录车辆或送货人信息 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/613-rm-041-shipping-delivery.png) |
| DR-0158 | RM-041 | 第一遍发货方式 | 切换为其他 | 其他方式用于软件、授权等无实体承运场景 | 确认非实物交付也可完成出库流程并用说明留痕 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/614-rm-041-shipping-other.png) |
| DR-0159 | RM-041 | 第一遍校验 | 在空其他出库单点击提交审批 | 系统阻止提交并标出出库类型与物料明细等必填项；未创建单据 | 确认即使选择无需物流的其他交付，也不能绕过业务类型和有效库存明细 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-041/615-rm-041-other-outbound-validation.png) |
| DR-0160 | RM-042 | 第一遍列表 | 打开销售直接出库 | 列表按直接出库单号关联客户单号与客户，显示出库进度、状态和创建时间，没有手工新建入口 | 确认销售直接出库必须由销售侧业务单生成，库存端只执行和跟踪 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-042/616-rm-042-sales-direct-list.png) |
| DR-0161 | RM-042 | 第一遍筛选 | 展开销售直接出库状态 | 状态包含待出库、部分出库、已完成 | 确认销售直接出库允许分批扣库并累计进度，直至订单完成 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-042/617-rm-042-sales-direct-status.png) |
| DR-0162 | RM-043 | 第一遍列表 | 打开待出库发货单 | 显示销售发货单号、客户单号、客户、收货人/地址、含税金额、出库进度、状态与日期，提供下一步出库单列表 | 确认销售发货单是库存出库的上游执行请求，保留客户交付金额与地址上下文 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-043/618-rm-043-pending-shipments.png) |
| DR-0163 | RM-044 | 第一遍列表 | 打开采购退换货出库 | 列表由采购退货单驱动，显示供应商、退货地址、金额、出库进度、状态和日期，没有手工新建入口 | 确认采购退货出库必须核销采购退换货单，并保持供应商、金额与实物流向一致 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-044/619-rm-044-purchase-return-outbound.png) |
| DR-0164 | RM-045 | 第一遍明细列表 | 打开出库明细 | 支持按出库单号、物料名称/编码、客户、物流单号、业务类型、状态和日期范围查询；逐行展示物料、数量、含税/不含税价、税率、金额、库位与物流 | 确认出库明细是库存、销售、税额和物流的行级对账底表，可用于成本与收入核对 | [截图](../../../references/risemap-capture/deep/supply-chain/outbound/rm-045/620-rm-045-outbound-line-details.png) |
