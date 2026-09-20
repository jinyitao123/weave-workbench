# 生产 / 组装业务管理

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
| RM-065 | 组装单 | `https://risemap.cn/production/assembly` | 组装单 | 全部(0)、草稿、审批中、待领料、组装中、已完工、已驳回、已取消、新建组装单、导出、导入/导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/266-rm-065-loaded.png) | 首屏已采集，流程未验证 |
| RM-066 | 缺料待办 | `https://risemap.cn/production/shortages` | 缺料待办 | 无 | [截图](../../../references/risemap-capture/268-rm-066-loaded.png) | 首屏已采集，流程未验证 |
| RM-067 | 领料单 | `https://risemap.cn/production/requisitions` | 领料单 | 全部(0)、审批中、已确认、已驳回、已作废、新建领料单、导出、导入/导出任务、刷新、全部类型、上一页、1、下一页 | [截图](../../../references/risemap-capture/270-rm-067-loaded.png) | 首屏已采集，流程未验证 |
| RM-068 | 补料单 | `https://risemap.cn/production/material-supplies` | 补料单 | 全部(0)、审批中(0)、已确认(0)、已驳回(0)、已作废(0)、新建补料单、导出、导入/导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/272-rm-068-loaded.png) | 首屏已采集，流程未验证 |
| RM-069 | 退料单 | `https://risemap.cn/production/material-returns` | 退料单 | 全部(0)、审批中(0)、已确认(0)、已驳回(0)、已作废(0)、新建退料单、导出、导入/导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/274-rm-069-loaded.png) | 首屏已采集，流程未验证 |
| RM-070 | 拆解单 | `https://risemap.cn/production/disassembly` | 拆解单 | 全部(0)、草稿、审批中、待领料、拆解中、已完工、已入库、已驳回、新建拆解单、导出、导入/导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/276-rm-070-loaded.png) | 首屏已采集，流程未验证 |
| RM-071 | 换件单 | `https://risemap.cn/production/rework` | 换件单 | 全部(0)、草稿、审批中、待领料、换件中、已完工、已入库、已驳回、新建换件单、导出、导入/导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/278-rm-071-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0348 | RM-065 | 组装单列表 | 进入组装单 | 统计总数、进行中、累计合格入库和累计物料投入；状态为草稿、审批中、待领料、组装中、已完工、已驳回、已取消。列表关联成品、BOM、计划/合格/不合格数量、物料种数成本和来源订单 | 组装单以 BOM 驱动领料和分批入库，入库数量与完工状态独立 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-065/804-rm-065-assembly-list.png) |
| DR-0349 | RM-065 | 组装单表单 | 打开新建组装单 | 必选物料、BOM、BOM版本和组装数量，版本依赖物料；可选入库仓库、销售订单、计划完工日期和备注。未选核心对象时保存草稿与保存并下达均禁用 | 组装单以成品 BOM 版本和数量生成需求，可回溯销售订单并指定入库地点 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-065/805-rm-065-assembly-form.png) |
| DR-0350 | RM-065 | 组装物料选择 | 打开物料选择 | 当前租户暂无启用物料，因此无法选择成品、加载 BOM 或启用保存按钮 | 组装流程依赖启用的物料和有效 BOM 主数据，空租户无法继续到齐套检查 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-065/806-rm-065-assembly-material-empty.png) |
| DR-0351 | RM-066 | 缺料待办 | 进入缺料待办 | 系统按计划完工日期优先分配库存，对在产组装单实时做齐套分析；统计缺料单据、缺料物料种数、缺口金额和最早完工日，齐套时显示无缺料 | 缺料待办是派生视图，基于在产需求和库存优先级自动形成而非人工建单 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-066/807-rm-066-shortage-dashboard.png) |
| DR-0352 | RM-067 | 领料单列表 | 进入领料单 | 领料单汇总单据、物料种类、数量和净领用金额；状态为审批中、已确认、已驳回、已作废，可按类型筛选。列表关联成品、来源单、经手人和日期 | 领料单统一承载组装、拆解、补退料出入库，并回溯来源业务单 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-067/808-rm-067-requisition-list.png) |
| DR-0353 | RM-067 | 领料类型 | 展开类型筛选 | 领料来源类型为组装单、拆解单和换件单 | 三类生产变动共用领料执行与金额口径 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-067/809-rm-067-requisition-types.png) |
| DR-0354 | RM-067 | 领料单新建 | 打开新建领料单 | 必须先选择待领料状态的组装单，当前无可选单据；只提供前往组装单或返回列表，物料明细在选择来源后展开 | 领料单不能脱离已下达组装需求独立创建，来源状态控制入口 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-067/810-rm-067-requisition-form-empty.png) |
| DR-0355 | RM-068 | 补料单列表 | 进入补料单 | 补料用于现场损耗、报废、漏装等超 BOM 用量补领，确认后出库扣减库存并关联组装单和库存流水；统计单数、物料种数、出库金额、来源单，状态为审批中/已确认/已驳回/已作废 | 补料把超 BOM 消耗显式归因并形成可审计库存出库 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-068/811-rm-068-supply-list.png) |
| DR-0356 | RM-068 | 补料单新建 | 打开新建补料单 | 必须先选择组装中状态的组装单，当前无可选单据；物料明细随后展开 | 补料只允许针对正在执行的组装单追加，避免脱离生产上下文的超额领料 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-068/812-rm-068-supply-form-empty.png) |
| DR-0357 | RM-069 | 退料单列表 | 进入退料单 | 退料用于多领、领错、余料回库，关联组装单和入库流水；统计单数、物料种数、入库金额、来源单，状态为审批中/已确认/已驳回/已作废，列表额外显示仓库 | 退料把剩余或错误领用恢复库存并保留来源和仓库证据 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-069/813-rm-069-return-list.png) |
| DR-0358 | RM-069 | 退料单新建 | 打开新建退料单 | 必须选择已有净领料数量的组装单，当前无可选单据；物料明细随后展开 | 退料上限和候选来源受净领料事实约束，不能凭空退回未领物料 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-069/814-rm-069-return-form-empty.png) |
| DR-0359 | RM-070 | 拆解单列表 | 进入拆解单 | 拆解按 BOM 将成品还原为物料，支持审批、回收入库和报废；统计单数、成品数、回收价值和报废损耗，状态为草稿、审批中、待领料、拆解中、已完工、已入库、已驳回 | 拆解同时核算成品消耗、可回收物料与报废损失，并把回收动作独立成入库状态 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-070/815-rm-070-disassembly-list.png) |
| DR-0360 | RM-070 | 拆解单表单 | 打开新建拆解单 | 必选商品、BOM、版本、数量和拆解原因；可选入库仓库与备注。选择商品后自动带出 BOM，明细可逐行设回收或报废；当前拆解原因无可用值，保存与确认禁用，并可跳转换件单 | 拆解把原因、BOM 版本、回收去向和报废决定固化在单据；原因字典也是前置配置 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-070/816-rm-070-disassembly-form.png) |
| DR-0361 | RM-070 | 拆解商品选择 | 打开商品选择 | 当前无启用物料，无法带出 BOM 和逐行回收/报废明细 | 拆解执行同时依赖启用的成品物料、BOM 版本和拆解原因 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-070/817-rm-070-disassembly-product-empty.png) |
| DR-0362 | RM-071 | 换件单列表 | 进入换件单 | 成品不离库，仅替换内部零件，支持审批、领新件和旧件回收；统计单数、换件处数、新件成本、旧件价值，状态为草稿、审批中、待领料、换件中、已完工、已入库、已驳回，并计算成本变化 | 换件以更小范围处理改制，独立核算新旧件成本差且不移动整机库存 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-071/818-rm-071-rework-list.png) |
| DR-0363 | RM-071 | 换件单表单 | 打开新建换件单 | 必选商品、改制成品 BOM、BOM 版本、改制数量和改制原因；仓库与备注可选。当前仓库和原因均无数据，保存/确认禁用 | 换件以 BOM 定位内部件，记录改制数量原因；仓库、原因字典和物料主数据是执行前置 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-071/819-rm-071-rework-form.png) |
| DR-0364 | RM-071 | 换件商品选择 | 打开商品选择 | 当前无启用物料，无法加载改制 BOM 与换件明细 | 换件执行被主数据缺口阻断，不产生空单 | [截图](../../../references/risemap-capture/deep/production/assembly/rm-071/820-rm-071-rework-product-empty.png) |
