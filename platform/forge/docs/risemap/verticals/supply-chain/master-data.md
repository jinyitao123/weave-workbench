# 供应链 / 基础资料

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
| RM-010 | 物料管理 | `https://risemap.cn/base/products` | 物料管理 | 物料列表、商品图片、新建物料、导入/导出、打印条码、批量操作、回收站、刷新、全部分类、品牌、类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/157-rm-010-loaded.png) | 首屏已采集，流程未验证 |
| RM-011 | 物料组合 | `https://risemap.cn/base/product-bundles` | 物料组合 | 新建物料组合、批量、导入/导出任务、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/159-rm-011-loaded.png) | 首屏已采集，流程未验证 |
| RM-012 | BOM管理 | `https://risemap.cn/base/bom` | BOM管理 | 全部 0、草稿 0、待评审 0、已生效 0、已失效 0、已归档 0、全部类型、标准、项目、导入/导出、BOM对比、新建BOM | [截图](../../../references/risemap-capture/161-rm-012-loaded.png) | 首屏已采集，流程未验证 |
| RM-013 | 综合物料搜索 | `https://risemap.cn/base/material-search` | 综合物料搜索 | 无 | [截图](../../../references/risemap-capture/163-rm-013-loaded.png) | 首屏已采集，流程未验证 |
| RM-014 | 供应商管理 | `https://risemap.cn/base/suppliers` | 供应商管理 | 供应商列表、资质管理、新增供应商、导入/导出、批量、刷新、范围、分类、等级、负责人、审批状态、业务状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/165-rm-014-loaded.png) | 首屏已采集，流程未验证 |
| RM-015 | 产品实例追溯 | `https://risemap.cn/base/barcode-center` | 产品实例追溯 | 物料编码、批次码、产品实例、质保管理、刷新、状态、来源、质保、上一页、1、下一页 | [截图](../../../references/risemap-capture/167-rm-015-loaded.png) | 首屏已采集，流程未验证 |
| RM-016 | 仓库管理 | `https://risemap.cn/base/warehouses` | 仓库管理、仓库列表 | 新增仓库、全部 | [截图](../../../references/risemap-capture/169-rm-016-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0001 | RM-016 | 列表空态 | 打开仓库管理并核对当前仓库、库存和采购统计 | 仓库总数、SKU、库存数量、采购金额均为 0，列表提示新增仓库 | 确认采购链路尚无仓库基础资料，需先创建测试仓库 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-016/457-rm-016-warehouse-baseline.png) |
| DR-0002 | RM-016 | 空表单 | 点击“新增仓库”打开新建表单 | 表单包含编码、名称、类型、负责人、电话、面积、地址和备注；名称、类型、负责人、电话、面积、地址标记必填 | 确认仓库是采购和库存的必需主数据，编码表面未标必填 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-016/458-rm-016-warehouse-empty-form.png) |
| DR-0003 | RM-016 | 校验 | 在仓库空表单点击“确认创建” | 页面提示“提交失败，请检查必填项”，并在名称、类型、负责人、电话、面积、地址下显示逐字段错误 | 确认空表单被阻止提交且未创建仓库 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-016/459-rm-016-warehouse-required-validation.png) |
| DR-0004 | RM-016 | 退出确认 | 空值校验后点击“取消” | 系统仍提示“你有未保存的内容，确定要关闭吗？” | 确认仅触发校验也会将表单视为有未保存内容，退出需要二次确认 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-016/460-rm-016-warehouse-close-confirm.png) |
| DR-0005 | RM-010 | 第一遍列表 | 检查物料管理列表、页签和可用操作 | 列表为空；提供物料列表/商品图片、新建、导入导出、条码打印、回收站、筛选和分页；批量操作在无选中项时禁用 | 确认第二遍创建物料前需定义分类、单位、价格与负责人 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-010/461-rm-010-product-list-pass1.png) |
| DR-0006 | RM-010 | 第一遍空表单 | 打开“新增物料”并展开可见字段 | 表单分为基本信息、规格与价格、批次与追溯、自定义信息；默认属性原材料、来源采购、状态启用、损耗率0，默认生成1个SKU；支持图片、文档、BOM、批次、追溯、保存并复制 | 确认第二遍必须先准备分类和单位，可选关联供应商、仓库、部门、负责人 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-010/462-rm-010-product-empty-form.png) |
| DR-0007 | RM-010 | 第一遍校验 | 在物料空表单点击“保存” | 名称、型号、物料分类、单位分别出现“不能为空”，表单仍保持打开且未创建记录 | 确认四项业务必填；编码、条码、品牌、采购分类和价格当前未被空值校验阻止 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-010/463-rm-010-product-required-validation.png) |
| DR-0008 | RM-010 | 第一遍退出 | 空值校验后点击物料表单“关闭” | 表单直接关闭，未出现未保存内容二次确认 | 与仓库表单行为不同；Forge 复刻需保留页面级退出策略差异或进一步验证是否仅填写后才确认 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-010/464-rm-010-product-close-after-validation.png) |
| DR-0009 | RM-014 | 第一遍列表 | 检查供应商列表、资质页签、筛选和列 | 供应商为空；列表包含分类、等级、负责人、审批状态、业务状态筛选及详细工商、联系、付款和账期字段；另有资质管理页签 | 确认供应商同时承担采购、审批、付款条件和资质依赖 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/465-rm-014-supplier-list-pass1.png) |
| DR-0010 | RM-014 | 第一遍空表单 | 打开“新增供应商”并核对全部分组 | 表单含基本信息/审批流程页签，企业信息、分类与负责人、联系与结算、其他信息四组；支持多银行账户、附件和资质；提供保存草稿与提交审核 | 确认供应商是带审批状态的主数据；第二遍需准备分类、级别、负责人、联系人和电话 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/466-rm-014-supplier-empty-form.png) |
| DR-0011 | RM-014 | 第一遍校验 | 在供应商空表单点击“提交审核” | 名称、分类、负责人、供应商级别、联系人、联系电话六项显示不能为空，表单未提交 | 确认提交审核的最低业务字段，不把可保存草稿误当作已审批供应商 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/467-rm-014-supplier-required-validation.png) |
| DR-0012 | RM-014 | 第一遍审批说明 | 切换到供应商“审批流程”页签 | 默认流程为开始→SINGLE审批（系统管理员）→结束；说明提交后进入待审批，审批通过前不可用于采购订单 | 确立供应商审批是采购订单的硬前置，第二遍必须实际完成审批再下单 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/468-rm-014-supplier-approval-tab.png) |
| DR-0013 | RM-014 | 第一遍页签 | 打开供应商“资质管理”页签 | 默认供应商视图按供应商统计资质总数、有效、即将到期、已过期和负责人，支持供应商状态筛选 | 确认资质有效期需要独立数据结构和到期状态 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/469-rm-014-supplier-qualification-view.png) |
| DR-0014 | RM-014 | 第一遍页签 | 切换到“资质证书视图” | 证书视图列出资质名称、供应商、证书编号、有效期、提醒、负责人、状态和操作，支持资质状态筛选 | 确认资质记录需支持到期提醒和负责人归属 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-014/470-rm-014-supplier-certificate-view.png) |
| DR-0015 | RM-011 | 第一遍列表 | 检查物料组合列表和操作 | 列表为空；物料组合用于报价快速引用，记录物料种类、含税/不含税销售价、引用次数、状态和创建信息 | 确认物料组合不是BOM，主要服务报价复用 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-011/471-rm-011-bundle-list-pass1.png) |
| DR-0016 | RM-011 | 第一遍空表单 | 打开新建物料组合页面 | 组合含名称、编号、含税开关、默认税率13%、售价、分类、品牌、型号、规格名、单位和描述；物料可通过粘贴、Excel、物料库或新增物料加入 | 确认组合是带自身商品属性和价格的报价套装，支持四种明细导入方式 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-011/472-rm-011-bundle-empty-form.png) |
| DR-0017 | RM-011 | 第一遍校验 | 在空物料组合页面点击“创建组合” | 页面提示检查必填项，当前仅组合名称显示不能为空；未对零条组合物料显示字段级错误 | 确认组合名称为首个硬校验；第二遍需验证零明细是否允许、价格换算和引用计数 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-011/473-rm-011-bundle-required-validation.png) |
| DR-0018 | RM-012 | 第一遍列表 | 检查BOM分类、状态、类型、对比和列表字段 | BOM分标准、项目、试制；状态含草稿、待评审、已生效、已失效、已归档；列表记录版本、适用项目、物料数与成本 | 确认BOM具有版本与评审生命周期，不能只复刻明细表 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/474-rm-012-bom-list-pass1.png) |
| DR-0019 | RM-012 | 第一遍入口 | 点击“新建BOM” | 提供“新建标准BOM”和“从标准BOM创建项目BOM”两个入口 | 确认项目BOM必须以标准BOM为来源，第二遍需先建立标准BOM | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/475-rm-012-bom-create-choice.png) |
| DR-0020 | RM-012 | 第一遍空表单 | 打开新建标准BOM | 新BOM默认标准、草稿、V1.0；提供基础资料、BOM结构、缺料分析、版本历史、应用/引用、审批日志、图纸关联七个页签；可保存或提交评审 | 确认BOM需要多页签详情和独立提交评审状态 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/476-rm-012-bom-new-basic.png) |
| DR-0021 | RM-012 | 第一遍校验 | 未保存的新BOM点击“提交评审” | 提示“请先保存 BOM”，没有进入字段校验或审批 | 确认评审动作要求持久化草稿，第二遍需保存后再提交 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/477-rm-012-bom-review-before-save.png) |
| DR-0022 | RM-012 | 第一遍校验 | 在新BOM空表单点击“保存” | BOM名称显示不能为空并阻止保存；产品/设备、成品物料当前未出现空值错误 | 确认名称是创建草稿的首个硬校验，其他依赖需第二遍逐项验证 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/478-rm-012-bom-required-validation.png) |
| DR-0023 | RM-012 | 第一遍页签 | 打开BOM结构页签 | 结构页支持搜索、收起导航、展开/折叠全部、添加根节点；空态统计采购/自制/外协/虚拟物料数和总成本 | 确认BOM是树形结构，节点来源分类和成本汇总属于核心行为 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/479-rm-012-bom-structure-tab.png) |
| DR-0024 | RM-012 | 第一遍页签 | 打开缺料分析页签 | 可设置计划生产数量，点击开始分析后按BOM结构和库存计算缺口；当前草稿且无结构 | 确认缺料算法依赖BOM数量、计划产量和实时库存 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/480-rm-012-bom-shortage-tab.png) |
| DR-0025 | RM-012 | 第一遍页签 | 打开版本历史页签 | 版本表记录版本号、状态、生效时间、变更说明、修改人/时间、物料数、成本、版本变更和评审记录；当前V1.0且无历史 | 确认每次BOM变更需形成可追溯版本与评审关联 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/481-rm-012-bom-version-tab.png) |
| DR-0026 | RM-012 | 第一遍页签 | 打开应用/引用页签 | 分别统计引用该BOM的订单、项目、关联采购请求和缺料分析 | 确认BOM影响范围跨订单、项目、采购和计划，版本变更需评估既有引用 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/482-rm-012-bom-references-tab.png) |
| DR-0027 | RM-012 | 第一遍页签 | 打开审批日志页签 | 未保存草稿显示暂无审批记录 | 确认BOM评审结果有独立日志而不只体现最终状态 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/483-rm-012-bom-approval-log-tab.png) |
| DR-0028 | RM-012 | 第一遍页签 | 打开图纸关联页签 | 表格列出图号、图纸名称、类型、版本、状态、关联物料、更新时间和操作 | 确认BOM与图纸版本是显式关联，第二遍需验证版本冻结与变更影响 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-012/484-rm-012-bom-drawing-tab.png) |
| DR-0029 | RM-013 | 第一遍搜索入口 | 检查综合物料搜索空态 | 说明可跨物料编码、名称、型号、品牌、供应商、物料组合、SN码和批次号搜索，并查看完整信息、利润、价格趋势和历史 | 确认搜索索引跨主数据、采购、库存、追溯和价格历史 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-013/485-rm-013-material-search-pass1.png) |
| DR-0030 | RM-013 | 第一遍搜索状态 | 搜索“Forge测试不存在” | 页面明确提示未找到匹配物料并建议更换关键词 | 确认无结果状态不显示历史卡片或模糊推荐，第二遍需用真实物料核对跨域命中 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-013/486-rm-013-material-search-no-result.png) |
| DR-0031 | RM-015 | 第一遍页签 | 检查产品实例追溯默认视图 | 默认表格列出追溯码、编码、物料、型号、规格、SKU/物料条码、外部SN、来源、状态、质保、客户和发货日期 | 确认产品实例把物料、销售发货、客户和质保串联 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/487-rm-015-traceability-instance-view.png) |
| DR-0032 | RM-015 | 第一遍页签 | 打开“物料编码”视图 | 按物料编码、名称、型号、分类、品牌、条码和状态展示，选择后可打印条码 | 确认物料主数据与标签打印绑定，打印操作要求选择记录 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/488-rm-015-traceability-material-code-view.png) |
| DR-0033 | RM-015 | 第一遍页签 | 打开“批次码”视图 | 批次记录含批次码、物料、型号、类型、状态、初始/当前数量、仓库、库位、入库日期和入库单号 | 确认批次数量与仓库库位、入库单据直接关联 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/489-rm-015-traceability-batch-view.png) |
| DR-0034 | RM-015 | 第一遍页签 | 打开“产品实例”视图 | 实例支持状态、来源、质保筛选，字段覆盖追溯码、内部/外部编码、SKU、客户与发货 | 确认每个可追溯产品实例是独立实体，可关联客户和出库 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/490-rm-015-traceability-product-instance-view.png) |
| DR-0035 | RM-015 | 第一遍页签 | 打开质保管理的“质保规则”视图 | 按物料设置质保月数、起算方式和保修范围 | 确认质保不是实例固定字段，而是物料规则驱动 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/491-rm-015-warranty-rules-view.png) |
| DR-0036 | RM-015 | 第一遍页签 | 打开质保管理的“质保状态”视图 | 按追溯码显示物料、客户、质保起止日、剩余天数和质保状态 | 确认质保状态由产品实例、客户、发货与规则共同计算 | [截图](../../../references/risemap-capture/deep/supply-chain/master-data/rm-015/492-rm-015-warranty-status-view.png) |
