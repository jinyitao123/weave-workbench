# 供应链 / 入库管理

当前发现 6 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-024 | 全部入库单 | `https://risemap.cn/inventory/inbound` | 全部入库单 | 新建期初入库、打印条码、导出、刷新、状态、类型、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/184-rm-024-loaded.png) | 首屏已采集，流程未验证 |
| RM-025 | 采购入库 | `https://risemap.cn/inventory/inbound/purchase` | 采购入库 | 当前环节 采购入库、新建采购入库、打印条码、导出、刷新、状态、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/186-rm-025-loaded.png) | 首屏已采集，流程未验证 |
| RM-026 | 生产入库 | `https://risemap.cn/inventory/inbound/production` | 生产入库 | 当前环节 生产入库、打印条码、导出、刷新、状态、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/188-rm-026-loaded.png) | 首屏已采集，流程未验证 |
| RM-027 | 其他入库 | `https://risemap.cn/inventory/inbound/other` | 其他入库 | 新建其他入库、打印条码、导出、刷新、状态、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/190-rm-027-loaded.png) | 首屏已采集，流程未验证 |
| RM-028 | 期初入库 | `https://risemap.cn/inventory/inbound/opening` | 期初入库 | 跳过期初入库、新建期初入库、打印条码、导出、刷新、状态、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/192-rm-028-loaded.png) | 首屏已采集，流程未验证 |
| RM-029 | 入库明细 | `https://risemap.cn/inventory/inbound/details` | 入库明细 | 刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/194-rm-029-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0086 | RM-024 | 第一遍列表 | 检查全部入库单的类型、来源和字段 | 统一列表记录入库单号、类型、来源、入库类型、批次、供应商/客户、仓库、日期、含税金额、状态和创建人；可从此新建期初入库并打印条码 | 确认所有来源最终归一为入库单，但保留来源、业务类型和对方单位维度 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-024/542-rm-024-all-inbound-list.png) |
| DR-0087 | RM-024 | 第一遍入口校验 | 空列表点击“打印条码” | 提示“暂无可打印条码的入库单”，未进入打印配置 | 确认条码打印依赖已有入库物料记录，不是独立标签生成入口 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-024/543-rm-024-inbound-barcode-guard.png) |
| DR-0088 | RM-025 | 第一遍列表 | 检查采购入库列表和新建入口 | 采购入库是检验完成后的下一环节，列表沿用统一入库字段并可新建采购入库、打印条码 | 确认采购入库是独立落库动作，不由检验通过直接自动完成 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-025/544-rm-025-purchase-inbound-list.png) |
| DR-0089 | RM-025 | 第一遍空表单 | 打开新建采购入库单 | 状态链为草稿→待审批→已审批→已入库；采购入库要求供应商和该供应商未完全入库的采购订单，物料由订单带出；表单还可切换其他入库、退货入库、期初入库 | 确认库存增加需审批后再执行入库，采购订单需按累计入库数量过滤和控制超入 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-025/545-rm-025-purchase-inbound-empty-form.png) |
| DR-0090 | RM-025 | 第一遍校验 | 在空采购入库单点击“提交审批” | 供应商、采购订单不能为空，并要求至少一行入库物料；未创建入库单 | 确认采购入库的单头来源和至少一个非零明细是审批前置 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-025/546-rm-025-purchase-inbound-validation.png) |
| DR-0091 | RM-027 | 第一遍空表单 | 切换为其他入库 | 其他入库必填业务入库类型，可选往来单位和到货原因；物料支持模板下载、Excel导入或从物料库添加 | 确认其他入库可无上游单据，但仍需要字典化入库类型和现有物料主数据 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/547-rm-027-other-inbound-form.png) |
| DR-0092 | RM-027 | 第一遍控件 | 展开其他入库“往来单位”类型 | 可选择客户或供应商，随后按对应主数据搜索单位 | 确认其他入库对方使用带类型的多态关联，不能只存一个名称字符串 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/548-rm-027-other-inbound-counterparty-menu.png) |
| DR-0093 | RM-027 | 第一遍校验 | 在空其他入库点击“提交审批” | 入库类型不能为空，并要求至少添加一行入库物料；往来单位和到货原因可空；未创建单据 | 确认其他入库最低业务约束是字典类型加明细，外部单位不是硬前置 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/549-rm-027-other-inbound-validation.png) |
| DR-0094 | RM-027 | 第一遍分支表单 | 切换为退货入库 | 退货入库要求客户和该客户待到货的销售退货单，物料由退货单带出 | 确认退货入库仍承接销售退货单；与退货到货登记的关系需第二遍验证是否为检验后生成或允许直接建单 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/550-rm-027-return-inbound-form.png) |
| DR-0095 | RM-027 | 第一遍校验 | 在空退货入库点击“提交审批” | 客户、退货单不能为空，并要求至少一行入库物料；未创建单据 | 确认退货入库不能脱离原销售退货单，也不能零明细审批 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/551-rm-027-return-inbound-validation.png) |
| DR-0096 | RM-028 | 第一遍空表单 | 切换为期初入库 | 期初入库无需往来单位与上游单据，物料支持模板、Excel或物料库添加，仍走草稿、审批、已入库状态链 | 确认期初库存通过独立入库单导入，并保留审批审计而非直接改库存余额 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-028/552-rm-028-opening-inbound-form.png) |
| DR-0097 | RM-028 | 第一遍校验 | 在空期初入库点击“提交审批” | 仅要求至少添加一行入库物料；日期有默认值；未创建单据 | 确认期初入库的最低前置为一条物料明细 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-028/553-rm-028-opening-inbound-validation.png) |
| DR-0098 | RM-026 | 第一遍列表 | 检查生产入库来源与可用操作 | 生产入库列表无手工新建按钮，仅提供条码、导出、状态和来源筛选 | 确认生产入库必须由生产业务产生，库存模块只展示和处理既有生产入库单 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-026/554-rm-026-production-inbound-list.png) |
| DR-0099 | RM-027 | 第一遍列表 | 检查其他入库列表和新建入口 | 其他入库提供独立新建入口，并沿用统一入库字段、状态和来源筛选 | 确认其他入库是正式单据类型，可在统一列表和专属列表分别查看 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-027/555-rm-027-other-inbound-list.png) |
| DR-0100 | RM-028 | 第一遍列表 | 检查期初入库引导和跳过入口 | 页面提示可录入期初库存或跳过直接开始正常入库，并提供新建、条码和统一列表；未点击“跳过期初入库”以避免修改租户初始化状态 | 确认期初入库是一次性启用门槛，跳过动作可能改变租户状态，需第二遍在数据方案确定后执行或保留 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-028/556-rm-028-opening-inbound-list.png) |
| DR-0101 | RM-029 | 第一遍明细列表 | 检查入库明细的行级字段和筛选 | 逐行记录日期、入库单号、业务类型、仓库、对方、制单人、物料编码/名称/型号/单位、数量、含税与不含税单价、税率、含税金额、库位、批次和状态 | 确认入库明细是库存成本与批次库位追踪的原子记录，并保留税价口径 | [截图](../../../references/risemap-capture/deep/supply-chain/inbound/rm-029/557-rm-029-inbound-detail-list.png) |
