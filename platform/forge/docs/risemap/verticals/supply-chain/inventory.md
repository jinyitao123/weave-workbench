# 供应链 / 库存管理

当前发现 9 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-030 | 库存总览 | `https://risemap.cn/inventory/overview` | 库存总览、各仓库含税成本总价、分类库存数量、库存动态 | 总览、物料库存、在途库存、分类汇总、仓库视图、调拨管理、报损管理 | [截图](../../../references/risemap-capture/196-rm-030-loaded.png) | 首屏已采集，流程未验证 |
| RM-031 | 不合格处理 | `https://risemap.cn/inventory/ncr` | 不合格处理 | 导出、刷新、状态、处置、缺陷、上一页、1、下一页 | [截图](../../../references/risemap-capture/198-rm-031-loaded.png) | 首屏已采集，流程未验证 |
| RM-032 | 库存流水 | `https://risemap.cn/inventory/flow` | 库存流水 | 库存流水、报表、导出、刷新、类型、仓库、流水号、日期、数量、上一页、1、下一页 | [截图](../../../references/risemap-capture/200-rm-032-loaded.png) | 首屏已采集，流程未验证 |
| RM-033 | 库存锁定 | `https://risemap.cn/inventory/lock` | 库存锁定 | 业务锁库、手动锁库、物料锁定概况、锁库操作日志、新增业务锁库、导出、刷新、业务类型、状态、全部仓库、上一页、1、下一页 | [截图](../../../references/risemap-capture/202-rm-033-loaded.png) | 首屏已采集，流程未验证 |
| RM-034 | 库存盘点 | `https://risemap.cn/inventory/check` | 库存盘点 | 新建盘点、导出、刷新、状态、类型、仓库、上一页、1、下一页 | [截图](../../../references/risemap-capture/204-rm-034-loaded.png) | 首屏已采集，流程未验证 |
| RM-035 | 调拨与借出 | `https://risemap.cn/inventory/transfer` | 调拨与借出 | 新建单据、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/206-rm-035-loaded.png) | 首屏已采集，流程未验证 |
| RM-036 | 库存预警 | `https://risemap.cn/inventory/alerts` | 库存预警 | 刷新、物料预警配置、预警设置、库存预警 暂无预警、交期预警 暂无预警、全部、低库存、超储预警、呆滞库存 | [截图](../../../references/risemap-capture/208-rm-036-loaded.png) | 首屏已采集，流程未验证 |
| RM-037 | 报损单 | `https://risemap.cn/inventory/damage` | 报损单 | 新建报损、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/210-rm-037-loaded.png) | 首屏已采集，流程未验证 |
| RM-038 | SN码管理 | `https://risemap.cn/inventory/sn-verify` | SN码管理 | SN码记录 0、SN码验证、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/212-rm-038-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0102 | RM-030 | 第一遍总览 | 检查库存总览指标和动态 | 汇总采购成本、预估销售价、毛利率、SKU、账面总量、在途、低库存与零售价物料；按仓库和分类汇总，并展示调拨、归还、报损近期影响 | 确认库存总览同时服务价值、数量、预警和变动审计，成本与销售价口径要分开 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/558-rm-030-inventory-overview.png) |
| DR-0103 | RM-030 | 第一遍页签 | 打开物料库存页签 | 按所有/我负责/下属负责筛选，字段含账面、可用、在途、锁定、辅助单位库存、含税/不含税成本均价与总价、预设售价、销售总价和毛利率 | 确认可用量需由账面量扣除锁定等状态，成本同时维护含税与不含税口径，并支持责任人范围 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/559-rm-030-material-inventory-tab.png) |
| DR-0104 | RM-030 | 第一遍页签 | 打开在途库存默认物料汇总 | 在途定义为已审核采购订单中尚未完成入库的物料；汇总订单数、数量、金额、物料种类，并按物料列供应商、订单、在途量、金额和最早到货日 | 确认在途量来源于采购订单未入库余额，可按物料汇总预测到货 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/560-rm-030-in-transit-material-summary.png) |
| DR-0105 | RM-030 | 第一遍页签 | 切换在途库存“订单明细” | 按采购信息和物料信息逐行展示到货进度、仓库、在途金额与预计到货日 | 确认在途库存支持从物料汇总下钻到采购订单行 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/561-rm-030-in-transit-order-detail.png) |
| DR-0106 | RM-030 | 第一遍页签 | 打开分类汇总页签 | 当前无分类库存数据，页面为独立分类汇总视图 | 确认库存需要按物料分类聚合并处理无分类数据空态 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/562-rm-030-inventory-category-summary.png) |
| DR-0107 | RM-030 | 第一遍页签 | 打开仓库视图默认“按库位查询” | 按仓库-库位层级浏览物料编码、分类、仓库、库位、账面/可用库存、成本均价和库存金额，并汇总SKU数、仓库数、数量和金额 | 确认库存余额至少以物料+仓库+库位为粒度，成本与可用量在该粒度查询 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/563-rm-030-inventory-warehouse-location-view.png) |
| DR-0108 | RM-030 | 第一遍页签 | 切换仓库视图为“按物料查询” | 仓库视图支持从物料维度反查各仓库与库位的库存分布 | 确认同一物料跨仓库分布需要可下钻聚合 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-030/564-rm-030-inventory-warehouse-material-view.png) |
| DR-0109 | RM-031 | 第一遍列表 | 检查不合格处理来源、缺陷和处置字段 | NCR 处理来料、在线和客退异常，记录来源单据、物料、供应商、不合格数量、缺陷等级、处置、状态和关联入库单 | 确认不合格品形成跨检验来源的独立NCR，并通过处置决定是否及如何入库 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-031/565-rm-031-nonconformance-list.png) |
| DR-0110 | RM-032 | 第一遍流水 | 检查库存流水原子字段 | 流水记录类型、业务类型、日期、仓库、库位、物料、SKU、规格、批次、内部/外部SN、操作人、数量、关联单号和对方，并汇总含税金额 | 确认每次库存增减需形成不可混淆的行级流水，支持批次与序列号追溯到来源单据 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-032/566-rm-032-inventory-flow-list.png) |
| DR-0111 | RM-032 | 第一遍报表 | 打开库存流水报表 | 报表汇总本月入/出库额与笔数、月度趋势中的金额/笔数/净入库/出入库比，以及仓库维度的入出库数量、金额和净变动 | 确认流水可重算月度与仓库统计，报表指标应以流水为唯一来源 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-032/567-rm-032-inventory-flow-report.png) |
| DR-0112 | RM-033 | 第一遍业务锁库 | 检查业务锁库指标和字段 | 统一管理业务占用、人工预留和释放；记录批次、业务来源、来源单号、锁定量、已释放、状态、业务状态、锁定日、到期释放与倒计时 | 确认锁定具有剩余量与部分释放，支持按业务状态或到期时间自动释放 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/568-rm-033-business-lock-list.png) |
| DR-0113 | RM-033 | 第一遍手动锁库 | 打开手动锁库页签 | 手动锁库记录锁库原因、补充说明、锁定量、已释放、状态、审批状态、到期释放和倒计时 | 确认人工预留独立于业务单据并带审批状态，释放仍可部分执行 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/569-rm-033-manual-lock-list.png) |
| DR-0114 | RM-033 | 第一遍空表单 | 打开新建锁库 | 支持订单锁库一次锁定订单全部物料，或手动逐项选择；需锁库原因、物料、锁定天数，默认7天，可设预计释放日和备注；两种均审批后才扣减可用库存，超过14天需审批 | 确认锁定提交与生效分离，只有审批通过才影响可用量，默认到期不自动续期 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/570-rm-033-manual-lock-empty-form.png) |
| DR-0115 | RM-033 | 第一遍分支表单 | 切换为订单锁库 | 订单锁库选择销售订单后自动导入全部订单物料并按订单数量锁库，各行可修改锁定数量；也允许补充手工物料 | 确认业务锁库主要承接销售订单，订单需求量是默认锁定量但可逐行调整 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/571-rm-033-order-lock-form.png) |
| DR-0116 | RM-033 | 第一遍校验 | 在空订单锁库点击“提交审批” | 要求选择销售订单并至少添加一行锁定物料；默认7天满足时长；未创建锁定单 | 确认订单锁库可通过销售订单或手工补充产生明细，但至少需要一个来源和一行锁定数量 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/572-rm-033-order-lock-validation.png) |
| DR-0117 | RM-033 | 第一遍概况页签 | 打开物料锁定概况 | 按物料、SKU和仓库对比账面库存、锁定数量、可用库存、在途、锁定率并可下钻明细 | 确认物料级可用量和锁定率可由锁定明细聚合，且在途单独展示 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/573-rm-033-material-lock-summary.png) |
| DR-0118 | RM-033 | 第一遍日志页签 | 打开锁库操作日志 | 日志按时间记录操作类型、锁定单号、锁库分类、操作内容和操作人，可按类型、分类、日期筛选 | 确认锁定、释放、续期等变更需要独立审计日志，而不只覆盖锁定单当前状态 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-033/574-rm-033-lock-operation-log.png) |
| DR-0119 | RM-034 | 第一遍列表 | 检查库存盘点计划、进度和锁账字段 | 盘点记录名称、仓库、类型、计划/实际日期、进度、差异项、盘差、状态、是否锁账、操作人和创建时间 | 确认盘点是计划化流程，盘盈盘亏需记录差异，并可选择锁账防止期间库存变动 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-034/575-rm-034-stocktake-list.png) |
| DR-0120 | RM-034 | 第一遍空表单 | 打开新建盘点默认全盘 | 必填名称、仓库、类型、计划日期；全盘自动加载仓库全部物料；可上传附件并启用盘点锁账，锁账冻结截止时间前的出入库、调拨单据修改删除 | 确认锁账影响单据可变性，盘点开始前需形成仓库物料快照 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-034/576-rm-034-stocktake-full-form.png) |
| DR-0121 | RM-034 | 第一遍盘点分支 | 切换为抽盘 | 抽盘比例可选10%至80%，当前摘要显示30%；系统随机抽取并支持重新抽取，也可手动添加物料 | 确认抽盘清单由仓库快照随机生成，比例和重新抽取结果需可追溯 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-034/577-rm-034-stocktake-sample-form.png) |
| DR-0122 | RM-034 | 第一遍盘点分支 | 切换为清盘 | 清盘自动加载仓库全部物料，用于清仓或闭仓前最终盘点 | 确认清盘与普通全盘业务语义不同，可能作为仓库停用前置证据 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-034/578-rm-034-stocktake-clear-form.png) |
| DR-0123 | RM-034 | 第一遍校验 | 在空清盘表单点击“保存草稿” | 盘点名称、仓库、计划日期不能为空，并要求至少一行盘点物料；未创建盘点单 | 确认盘点即使保存草稿也需完整计划范围和快照明细 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-034/579-rm-034-stocktake-validation.png) |
| DR-0124 | RM-035 | 第一遍列表 | 检查调拨借出业务类型和单据字段 | 统一管理跨仓库调拨、借出归还与外协领用，记录发出方、接收方、原因、物料数量、金额、状态、关联单据、日期和申请人 | 确认同一单据框架覆盖所有权不变的库间移动、临时借用和外协领料 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/580-rm-035-transfer-loan-list.png) |
| DR-0125 | RM-035 | 第一遍空表单 | 打开新建普通调拨默认跨仓模式 | 业务类型普通调拨/借出管理/变价调拨；普通调拨可跨仓或库内移位，要求发货仓、调入仓、原因和物料；默认一行、数量1、单位台，含批次/SN和调出/调入库位；审核后才执行且数量不得超库存 | 确认调拨单先审批后执行，库存校验需覆盖仓库、库位、批次和序列号 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/581-rm-035-transfer-cross-warehouse-form.png) |
| DR-0126 | RM-035 | 第一遍调拨分支 | 切换普通调拨为库内移位 | 单头只选择一个移位仓库，行上调出库位与调入库位均必填 | 确认库内移位不改变仓库总量，只改变库位余额并产生对应流水 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/582-rm-035-transfer-within-warehouse-form.png) |
| DR-0127 | RM-035 | 第一遍借出分支 | 切换为借出管理默认借出 | 借出选择发货仓库、接收单位、收货地址和原因，物料带批次/SN与调出库位；说明借出后设备仍属公司资产并需确认期限责任人 | 确认借出减少仓内可用但不转移资产所有权，需独立跟踪对方、期限和归还 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/583-rm-035-loan-out-form.png) |
| DR-0128 | RM-035 | 第一遍借出分支 | 切换借出管理为归还 | 归还选择归还单位、接收仓库并强制关联待归还借出单用于核销，物料行写入调入库位 | 确认归还必须冲销原借出余额，不能作为无来源的普通入库 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/584-rm-035-loan-return-form.png) |
| DR-0129 | RM-035 | 第一遍调拨分支 | 切换为变价调拨 | 跨仓调拨同时支持全局调价比例应用和逐行调后价，行保留原含税/不含税单价、税率与金额 | 确认变价调拨会改变接收仓库存成本，需要保存原价、调后价和调价依据 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/585-rm-035-repricing-transfer-form.png) |
| DR-0130 | RM-035 | 第一遍校验 | 在空变价调拨点击“提交审核” | 调出仓库、调入仓库、调拨原因不能为空，并要求至少一行有效调拨物料；未创建单据 | 确认空白占位行不算有效明细，变价调拨仍先满足仓库与原因约束 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-035/586-rm-035-transfer-validation.png) |
| DR-0131 | RM-036 | 第一遍列表 | 打开库存预警中心 | 统一呈现库存预警与交期预警、紧急/中等/提醒数量和预警资产额；库存预警可按全部、低库存、超储、呆滞筛选 | 确定预警中心同时覆盖库存数量、库龄与订单交期风险，可作为补货和履约异常入口 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/587-rm-036-alerts-baseline.png) |
| DR-0132 | RM-036 | 第一遍筛选 | 切换到低库存 | 低库存页当前为空，显示库存状态良好 | 低库存规则只展示触发阈值的物料，空租户不会产生误报 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/588-rm-036-low-stock-tab.png) |
| DR-0133 | RM-036 | 第一遍筛选 | 切换到超储预警 | 超储预警页当前为空 | 确认超储是库存数量上限规则的独立风险类别 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/589-rm-036-overstock-tab.png) |
| DR-0134 | RM-036 | 第一遍筛选 | 切换到呆滞库存 | 呆滞库存页当前为空 | 确认按库龄或周转规则识别长期未动库存 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/590-rm-036-slow-stock-tab.png) |
| DR-0135 | RM-036 | 第一遍配置列表 | 打开物料预警配置 | 按商品订货号维度维护管理模式、最低/安全/最高库存、当前库存、状态和启用开关，支持分类与模式筛选及导出 | 确认每个订货号可有独立库存阈值，是补货建议和超储识别的数据源 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/591-rm-036-material-alert-config.png) |
| DR-0136 | RM-036 | 第一遍配置表单 | 打开新建库存规则 | 规则选择物料后可用统一库存管理；最低库存触发紧急预警，安全库存触发补货提醒，最高库存触发超储预警，可备注并启停 | 确认三段阈值语义和规则启用开关，支持同一物料全仓统一控制 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/592-rm-036-new-unified-rule.png) |
| DR-0137 | RM-036 | 第一遍配置分支 | 切换为分仓库存管理 | 分仓模式要求为每个仓库独立设置库存阈值 | 确认多仓可按容量与服务区域配置不同上下限，不被统一阈值覆盖 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/593-rm-036-new-warehouse-rule.png) |
| DR-0138 | RM-036 | 第一遍校验 | 未选择物料直接创建规则 | 系统阻止创建并提示请选择物料；未创建规则 | 确认物料是预警规则的首要关联对象，空规则不可落库 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/594-rm-036-rule-validation.png) |
| DR-0139 | RM-036 | 第一遍全局设置 | 打开预警设置 | 库存规则默认启用低库存、超储、呆滞；提前 7 天基于月均消耗，超储为最大库存 120%，呆滞 180 天；采购交期临近 7 天、紧急 2 天；通知按角色分发 | 确认全局参数与物料阈值共同决定预警，通知对象是角色下所有用户 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-036/595-rm-036-global-alert-settings.png) |
| DR-0140 | RM-037 | 第一遍列表 | 打开报损单 | 报损覆盖商品损坏、丢失与盘亏，列表含仓库、类型、物料、金额、经手人、状态和创建日期，并支持审批流程 | 确认报损是带金额与审批的库存减损业务，不是直接改库存 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-037/596-rm-037-damage-list.png) |
| DR-0141 | RM-037 | 第一遍表单 | 打开新建报损单 | 基本信息要求仓库与报损类型，明细从库存物料选择并汇总种类、总量和金额；提交后审核通过自动扣减库存 | 确认报损数量和金额由库存明细形成，审批是实际扣库的边界 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-037/597-rm-037-damage-form.png) |
| DR-0142 | RM-037 | 第一遍字典入口 | 打开快捷新增报损类型 | 报损类型可现场新增名称、描述与标识颜色 | 确认报损原因是可配置字典，并在制单时提供快捷维护入口 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-037/598-rm-037-damage-type-quick-add.png) |
| DR-0143 | RM-037 | 第一遍校验 | 在空报损单点击提交审核 | 系统提示请选择仓库、请选择报损类型、请添加报损物料；未创建报损单 | 确认仓库、原因和至少一行库存明细共同构成报损提交门槛 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-037/599-rm-037-damage-validation.png) |
| DR-0144 | RM-038 | 第一遍记录列表 | 打开 SN 码管理 | SN 记录按供应商序列号关联产品、入库单、批次、供应商、出库状态与出库单，支持状态筛选 | 确认 SN 在入库生成并贯穿批次、供应商和出库追踪，可形成单件级谱系 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-038/600-rm-038-sn-records.png) |
| DR-0145 | RM-038 | 第一遍验证入口 | 切换到 SN 码验证 | 支持输入或扫描序列号，空值时验证按钮禁用 | 确认验证入口可供收货、出库或售后现场扫描，避免空查询 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-038/601-rm-038-sn-verify-tab.png) |
| DR-0146 | RM-038 | 第一遍验证结果 | 验证不存在的序列号 | 返回未找到匹配记录，并提示可能来自其他渠道或入库未扫描，应核实来源；同时保留最近验证记录时间 | 确认验证失败有明确的渠道/漏扫解释和可追溯查询记录，不会误判为有效库存 | [截图](../../../references/risemap-capture/deep/supply-chain/inventory/rm-038/602-rm-038-sn-not-found.png) |
