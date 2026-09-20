# 供应链 / 到货检验

当前发现 5 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-005 | 到货通知 | `https://risemap.cn/inventory/arrival-notices` | 到货通知 | 合并到货登记、刷新、筛选目标仓库、状态、是否逾期、上一页、1、下一页 | [截图](../../../references/risemap-capture/147-rm-005-loaded.png) | 首屏已采集，流程未验证 |
| RM-006 | 到货登记 | `https://risemap.cn/inventory/arrival` | 到货登记 | 下一步操作 待检验库存、订单明细、物料明细、新建到货登记、导出、导入/导出任务、刷新、状态、类型、上一页、1、下一页 | [截图](../../../references/risemap-capture/149-rm-006-loaded.png) | 首屏已采集，流程未验证 |
| RM-007 | 待检验库存 | `https://risemap.cn/inventory/pending-inspection` | 待检验库存 | 下一步操作 检验单、导出、导入/导出任务、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/151-rm-007-loaded.png) | 首屏已采集，流程未验证 |
| RM-008 | 检验单 | `https://risemap.cn/inventory/inspection` | 检验单 | 下一步操作 采购入库、导出、导入/导出任务、刷新、状态、结果、方式、供应商、上一页、1、下一页 | [截图](../../../references/risemap-capture/153-rm-008-loaded.png) | 首屏已采集，流程未验证 |
| RM-009 | 检验规则 | `https://risemap.cn/inventory/inspection-rules` | 检验规则 | 检验项目库、检验方案、新建检验项目、批量启用、批量停用、导入、导出、刷新、分类、判定类型、检验类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/155-rm-009-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0062 | RM-005 | 第一遍列表 | 检查到货通知来源、进度和合并登记入口 | 采购订单审核后按目标仓库进入待到货队列；记录供应商/物料、预计到货、目标仓库、来源订单、到货进度和采购员；可多选合并到货登记，无记录时禁用 | 确认到货通知由已审核采购订单派生，合并登记需要目标仓库和来源订单等兼容条件 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-005/518-rm-005-arrival-notice-list.png) |
| DR-0063 | RM-006 | 第一遍列表 | 检查到货登记列表、类型和后续入口 | 到货登记后进入待检或免检；列表记录到货单号、类型、日期、仓库、对方、关联单号、物料种类、含税金额和状态；支持订单/物料两种视图 | 确认到货登记是实物到场事件，并按检验规则分流待检或免检 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/519-rm-006-arrival-registration-list.png) |
| DR-0064 | RM-006 | 第一遍页签 | 切换到货登记“物料明细”视图 | 物料视图已打开，按到货物料粒度提供独立查询与跟踪入口 | 确认一张到货单的各物料行需要独立状态，而不只维护单头状态 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/520-rm-006-arrival-registration-material-view.png) |
| DR-0065 | RM-006 | 第一遍空表单 | 打开新建采购到货登记 | 默认采购到货与当天日期，流程条为到货登记→待检库存→检验单→入库单；采购到货强制供应商和采购订单，选择后带出订单物料；另有其他到货、退货到货类型 | 确认采购到货严格承接采购订单，并显式展示到检验和入库的后续状态链 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/521-rm-006-purchase-arrival-empty-form.png) |
| DR-0066 | RM-006 | 第一遍分支表单 | 切换为“其他到货” | 其他到货改为填写入库类型、到货原因，可选客户/供应商，并允许直接添加物料，不要求采购订单 | 确认非采购来源可独立登记到货，仍进入统一待检、检验和入库链路 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/522-rm-006-other-arrival-form.png) |
| DR-0067 | RM-006 | 第一遍明细入口 | 在其他到货点击“添加物料” | 物料选择器分两步，第一步按分类、物料属性、来源类型筛选并可切换图片，选择后下一步；当前物料库为空所以不可继续 | 确认其他到货必须选择现有物料主数据，不能在到货单内临时手工创建物料 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/523-rm-006-other-arrival-material-picker.png) |
| DR-0068 | RM-006 | 第一遍分支表单 | 切换为“退货到货” | 退货到货要求先选客户，再从该客户待到货的销售退货单选择，物料由退货单带出；可选供应商作为关联单位 | 确认这里承接销售退货实物回流，与采购退换货中的供应商补货是不同来源 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/524-rm-006-sales-return-arrival-form.png) |
| DR-0069 | RM-006 | 第一遍校验 | 在空退货到货表单点击“提交待检” | 客户、退货单不能为空，并要求至少一行到货物料；未创建到货登记 | 确认销售退货入场必须绑定客户和原退货单，且至少存在一个回流物料行 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/525-rm-006-sales-return-arrival-validation.png) |
| DR-0070 | RM-007 | 第一遍列表 | 检查待检库存记录粒度和字段 | 每个物料独立生成一条待检记录，跟踪到货数量、批次、供应商/客户、采购合同、到货日期、状态、关联检验单和结果 | 确认检验状态是到货物料行级实体，可在同一到货单中分开处理 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-007/526-rm-007-pending-inspection-list.png) |
| DR-0071 | RM-008 | 第一遍列表 | 检查检验单粒度、数量与结果字段 | 每张检验单对应一种物料，记录总量、合格量、不合格量、结果、状态、检验员和来源到货单；完成后下一步采购入库 | 确认检验结果需满足总量等于合格量加不合格量，并以物料为单据粒度 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-008/527-rm-008-inspection-order-list.png) |
| DR-0072 | RM-009 | 第一遍项目库 | 检查检验项目模板字段和批量操作 | 项目模板含编码、名称、分类、判定类型、适用检验类型、单位、是否必检、是否影响整批结论和启用状态；支持批量启停和导入导出 | 确认检验项目可复用，且单项失败是否否决整批是显式规则 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/528-rm-009-inspection-item-library.png) |
| DR-0073 | RM-009 | 第一遍空表单 | 打开新建检验项目默认“结果型” | 默认分类IQC、适用来料检验、启用、必检；判定类型可结果/数值/选项/文本/附件；结果型预置合格与不合格，可设默认合格项、异常备注；质量属性含缺陷等级、让步接收、异常处理、参考标准和附件 | 确认检验项目同时定义录入控件、批次影响、缺陷等级和异常处置规则 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/529-rm-009-inspection-item-result-form.png) |
| DR-0074 | RM-009 | 第一遍判定分支 | 切换为数值型检验项目 | 数值型配置标准值、上下限、单位、小数位数和自动判定，适用于厚度、电压、电阻、长度、重量等 | 确认数值检验根据可配置上下限自动得出合格结果，数值精度也是规则组成 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/530-rm-009-inspection-item-numeric.png) |
| DR-0075 | RM-009 | 第一遍判定分支 | 切换为选项型检验项目 | 选项型可配置多项及各自是否合格，并可允许多选，适用于标签、包装、资料状态 | 确认离散状态的合格映射由模板维护，多选结果也需参与最终判定 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/531-rm-009-inspection-item-option.png) |
| DR-0076 | RM-009 | 第一遍判定分支 | 切换为文本型检验项目 | 文本型自由录入描述，不参与自动判定，可设必填、最大长度和输入说明，默认最大500字 | 确认文本项用于说明性证据，合格结论不能从文本内容自动推导 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/532-rm-009-inspection-item-text.png) |
| DR-0077 | RM-009 | 第一遍判定分支 | 切换为附件型检验项目 | 附件型默认必须上传且需要人工判定，可配置允许文件类型，默认PDF/JPG/PNG，适用于合格证、材质报告和检测报告 | 确认文件证据可作为强制检验输入，并可选择是否由人工给出结论 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/533-rm-009-inspection-item-attachment.png) |
| DR-0078 | RM-009 | 第一遍校验 | 在空附件型检验项目点击“保存” | 仅项目名称显示不能为空；分类、判定类型、适用检验类型和附件默认配置已满足校验；未创建项目 | 确认项目名称是默认配置下首个硬校验，规则分支的内部参数有有效默认值 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/534-rm-009-inspection-item-validation.png) |
| DR-0079 | RM-009 | 第一遍方案页签 | 打开检验方案页签 | 方案针对物料、分类、供应商配置检验标准与抽检规则；列表含方案编码、名称、检验类型、默认方式、项目数、启用状态，支持复制与批量启停 | 确认检验项目模板需经方案组合并按适用范围选择，抽检规则属于方案而非项目 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/535-rm-009-inspection-plan-list.png) |
| DR-0080 | RM-009 | 第一遍空表单 | 打开新建检验方案 | 必填名称、检验类型、默认检验方式、适用方式和至少一个检验项目；类型来料/外协/成品，方式全检/抽检/免检；适用范围可指定物料、物料分类或供应商，方案项目可局部覆盖模板配置 | 确认系统按到货物料与范围条件自动匹配方案，方案级覆盖必须与项目模板分层保存 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/536-rm-009-inspection-plan-empty-form.png) |
| DR-0081 | RM-009 | 第一遍抽检分支 | 将检验方式切换为抽检 | 抽检默认固定数量10；失败处理可转全检、直接拒收、发起让步接收审批或手工判定；可允许部分合格及继续全检剩余数量 | 确认抽检失败的后续路由是可配置业务规则，且部分合格会影响库存分流 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/537-rm-009-inspection-plan-sampling-fixed-count.png) |
| DR-0082 | RM-009 | 第一遍抽样分支 | 切换为固定比例抽样 | 默认比例10%、最低5件、最高50件，页面给出到货100件抽10件的计算示意 | 确认比例抽样需要上下限夹取，样本量不能只按比例四舍五入 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/538-rm-009-inspection-plan-sampling-ratio.png) |
| DR-0083 | RM-009 | 第一遍抽样分支 | 切换为手工输入抽样 | 方案不预设抽样数量或比例，检验执行时由人员输入样本量，仍沿用失败处理规则 | 确认手工抽样把样本量决策延后到检验单执行阶段 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/539-rm-009-inspection-plan-sampling-manual.png) |
| DR-0084 | RM-009 | 第一遍检验方式分支 | 切换为免检方案 | 抽检规则区消失，方案仍显示适用范围和检验项目清单 | 确认免检是方案级默认方式，命中后可绕过检验执行，但页面仍保留项目清单配置入口 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/540-rm-009-inspection-plan-exempt.png) |
| DR-0085 | RM-009 | 第一遍校验 | 在空免检方案点击“保存” | 方案名称不能为空，并明确要求至少添加一个检验项目；未创建方案 | 确认即使免检方案也必须绑定检验项目，不能把项目清单在实现中设为免检可选 | [截图](../../../references/risemap-capture/deep/supply-chain/arrival-inspection/rm-009/541-rm-009-inspection-plan-validation.png) |
