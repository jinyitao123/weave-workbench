# 供应链 / 采购管理

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
| RM-017 | 采购发票 | `https://risemap.cn/purchase/invoices` | 采购发票 | 全部、正常、已作废、已红冲、邮件收票、导出、刷新、抵扣状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/171-rm-017-loaded.png) | 首屏已采集，流程未验证 |
| RM-018 | 采购申请 | `https://risemap.cn/purchase/requests` | 采购申请 | 下一步操作 采购待办池、申请列表、物料明细、新建申请、导入/导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/173-rm-018-loaded.png) | 首屏已采集，流程未验证 |
| RM-019 | 采购待办池 | `https://risemap.cn/purchase/pending-pool` | 采购待办池、使用提示 | 下一步操作 询价管理、待办列表、分组视图、批量创建订单、批量生成询价单、智能拆分、批量指定供应商、批量暂缓、批量关闭、导出、导入/导出任务、刷新、状态、优先级、部门、上一页、1、下一页 | [截图](../../../references/risemap-capture/175-rm-019-loaded.png) | 首屏已采集，流程未验证 |
| RM-020 | 询价管理 | `https://risemap.cn/purchase/rfq` | 询价管理 | 下一步操作 采购订单、新建询价单、导出、导入/导出任务、刷新、范围、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/177-rm-020-loaded.png) | 首屏已采集，流程未验证 |
| RM-021 | 采购订单 | `https://risemap.cn/purchase/orders` | 采购订单 | 下一步操作 到货通知、订单列表、订单明细 0、新建采购单、导入/导出、付款申请、收票登记、刷新、范围、状态、筛选供应商...、开票、入库、付款、上一页、1、下一页 | [截图](../../../references/risemap-capture/179-rm-021-loaded.png) | 首屏已采集，流程未验证 |
| RM-022 | 采购退换货 | `https://risemap.cn/purchase/returns` | 采购退换货 | 新建退换货、导出、导入/导出任务、刷新、全部、退货退款、换货补货、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/181-rm-022-loaded.png) | 首屏已采集，流程未验证 |
| RM-023 | 供应商价格本 | `https://risemap.cn/purchase/pricebook` | 供应商价格本 | 全部、草稿、生效中、已过期、已废弃、导出、导入/导出任务、新建价格本 | [截图](../../../references/risemap-capture/182-rm-023-recovered-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0037 | RM-018 | 第一遍列表 | 检查采购申请列表、物料明细页签和字段 | 申请包含编号、标题、优先级、项目、客户、负责人、物料数、数量、预估金额、币种、到货日期、建议供应商、原因、备注和状态；下一步指向采购待办池 | 确认采购申请是带审批与项目/客户归属的需求单 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-018/493-rm-018-purchase-request-list-pass1.png) |
| DR-0038 | RM-018 | 第一遍空表单 | 打开新建采购申请并等待审批流加载 | 创建方式默认直接新建；默认优先级中、币种人民币、申请日当天；明细支持物料库、手动、粘贴、Excel、组合和销售订单六种来源；审批为系统管理员单人节点 | 确认采购申请可从销售订单驱动并可先保存草稿，审批后进入待办池 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-018/494-rm-018-purchase-request-empty-form.png) |
| DR-0039 | RM-018 | 第一遍校验 | 在空采购申请点击“提交审批” | 期望到货日期、负责人、采购原因显示不能为空；币种已有默认；标题和零条明细当前未显示字段错误 | 确认表单允许标题为空的可能性，明细要求需在第二遍分阶段验证 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-018/495-rm-018-purchase-request-validation.png) |
| DR-0040 | RM-018 | 第一遍明细 | 点击“手动添加”新增未保存的采购明细行 | 行字段为名称、型号、规格、分类、单位、数量、含税/不含税单价、税率和含税小计；单位默认台、数量1、价格0、税率13%；汇总即时显示1项和总额0 | 确认手工明细可绕开物料库，价格与税额按行计算 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-018/496-rm-018-purchase-request-manual-line.png) |
| DR-0041 | RM-018 | 第一遍页签 | 打开采购申请“物料明细”页签 | 按物料维度展示编码、名称、规格、型号、数量、预估单价/金额、申请、项目、负责人、到货日期和状态，并支持优先级与到货期筛选 | 确认一张申请可拆为独立物料行进入后续待办池 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-018/497-rm-018-purchase-request-material-tab.png) |
| DR-0042 | RM-019 | 第一遍列表 | 检查采购待办池列表、批量动作与使用提示 | 待办行从采购申请明细拆出，跟踪申请/锁定/已下单/剩余数量；支持批量订单、询价、智能拆分、指定供应商、暂缓、关闭；提示可分批、多供应商、部分下单 | 确认待办池是数量分配与订单生成中间层，剩余可下单数量是核心不变量 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-019/498-rm-019-pending-pool-list-pass1.png) |
| DR-0043 | RM-019 | 第一遍页签 | 打开待办池分组视图 | 可按供应商、采购分类、物料、来源申请分组，并全部展开或收起 | 确认智能分单至少需要四种分组维度，不能仅按供应商 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-019/499-rm-019-pending-pool-group-view.png) |
| DR-0044 | RM-020 | 第一遍列表 | 检查询价管理生命周期和列表 | 生命周期为创建待发布→发布并生成链接/期限→收集报价→确认比价→转采购单；任意阶段可关闭失效；列表统计供应商报价数和物料数 | 确认询价有外部报价链接和可中止状态，转单发生在比价后 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-020/500-rm-020-rfq-list-pass1.png) |
| DR-0045 | RM-020 | 第一遍入口 | 点击“新建询价单” | 提供手动创建、从采购需求创建、从销售合同创建；后两者自动带入物料 | 确认询价来源可跨采购申请和销售合同，来源追溯需保留 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-020/501-rm-020-rfq-create-methods.png) |
| DR-0046 | RM-020 | 第一遍空表单 | 选择手动创建询价 | 第一步仅填写询价标题、可选项目和截止日期；截止日期默认当天，确认后才进入物料编辑页 | 确认询价采用两阶段创建，基本信息确认动作可能先持久化记录 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-020/502-rm-020-rfq-manual-basic-form.png) |
| DR-0047 | RM-020 | 第一遍校验 | 手动询价基本信息留空点击“确认并编辑物料” | 询价标题显示不能为空；截止日期已有当天默认值；未创建询价单 | 确认第一阶段唯一显式空值错误是标题，截止日期默认当天可能允许当日截止 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-020/503-rm-020-rfq-basic-validation.png) |
| DR-0048 | RM-021 | 第一遍列表 | 检查采购订单列表、进度和快捷动作 | 订单跟踪供应商单号、关联内容、到货日、仓库、付款条件/方式、结算日、应付产生方式、金额、已申请金额、开票/入库/付款进度和退货；可直接发起付款申请与收票登记 | 确认采购订单是到货、应付、开票、付款和退货的中心单据 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-021/504-rm-021-purchase-order-list-pass1.png) |
| DR-0049 | RM-021 | 第一遍空表单 | 打开新建采购订单并等待默认值和审批流加载 | 采购来源有库存补充、项目采购、以销定采、BOM缺料、采购申请五类；默认库存补充、人民币、汇率1、应付按入库、统一交货日；明细支持物料库、手动、粘贴、Excel、组合和销售订单；审批为系统管理员单人节点 | 确认采购订单可由五种业务需求产生，应付时点是可配置业务规则 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-021/505-rm-021-purchase-order-empty-form.png) |
| DR-0050 | RM-021 | 第一遍校验 | 在空采购订单点击“提交审核” | 供应商、付款条件、付款方式、期望到货日期显示不能为空；页面仍停留在新建页且未创建订单 | 确认四项是当前采购订单提交的显式必填，零条物料是否允许需第二遍分阶段验证 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-021/506-rm-021-purchase-order-validation.png) |
| DR-0051 | RM-021 | 第一遍关联入口 | 从采购订单列表打开“付款申请” | 付款采用三步流程：选择供应商、在订单填写申请金额、填写付款方式/收款账户/计划付款日/备注；提交后推送财务审批，实际付款账户和核销由财务处理 | 确认供应链只发起付款申请，财务侧完成审批、支付和核销；申请必须绑定供应商和具体订单金额 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-021/507-rm-021-purchase-payment-application.png) |
| DR-0052 | RM-021 | 第一遍关联入口校验 | 未选择采购订单直接点击“收票登记” | 页面提示“请先选择订单”，未打开登记表单 | 确认收票登记必须从已选采购订单发起，第一遍空租户无法继续查看订单级表单 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-021/508-rm-021-receipt-registration-guard.png) |
| DR-0053 | RM-017 | 第一遍列表 | 检查采购发票状态、字段和联动说明 | 发票分全部/正常/已作废/已红冲；记录发票号与类型、日期、供应商、价税合计、税率、分摊订单、抵扣状态、登记人；说明票可分摊至订单且登记后自动联动应付 | 确认采购发票有作废、红冲和抵扣生命周期，订单分摊会驱动应付联动 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-017/509-rm-017-purchase-invoice-list.png) |
| DR-0054 | RM-017 | 第一遍邮件收票 | 打开“邮件收票中心” | 邮箱由系统设置统一维护，管理员和财务可查看全部；邮件状态有待处理、识别失败、匹配异常、已处理，可同步并一键匹配；当前无邮箱和邮件 | 确认采购发票还支持邮件附件识别与订单匹配，并保留识别/匹配异常人工处理状态 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-017/510-rm-017-purchase-invoice-mail-center.png) |
| DR-0055 | RM-022 | 第一遍列表 | 检查采购退换货类型、进度和列表字段 | 流程处理质量不符或规格异常并跟进供应商退款；类型分退货退款、换货补货，记录关联订单、供应商、处理方式、换货进度、预计补货日、原因、退款或参考货值与状态 | 确认退货退款和换货补货共享单据但有不同后续状态，必须关联采购订单 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-022/511-rm-022-purchase-return-list.png) |
| DR-0056 | RM-022 | 第一遍空表单 | 打开新建采购退货单 | 默认退货退款、人民币、汇率1、退货日期当天；必填处理方式、供应商、采购订单、退款方式；订单物料在选择供应商与订单后自动带出；支持智能识别文本、退货地址联系人、附件和备注 | 确认退货基于原采购订单和原订单物料，不能自由新增不在订单内的退货明细 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-022/512-rm-022-purchase-return-empty-form.png) |
| DR-0057 | RM-022 | 第一遍分支表单 | 切换处理方式为“换货补货” | 换货不进入退款和财务审核，仅限原订单同一行、同SKU、等量换货，补货使用独立到货额度；必填预计补货日；流程为申请、仓库确认退回、退货出库、供应商补货、检验入库 | 确认换货是数量守恒的原SKU替换流程，并复用退货出库与到货检验而不产生退款 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-022/513-rm-022-purchase-replacement-form.png) |
| DR-0058 | RM-022 | 第一遍校验 | 在空换货补货表单点击“提交退货申请” | 供应商、关联采购订单、预计补货日期显示不能为空，并要求至少填写一项退货数量；表单未提交 | 确认换货提交同时校验来源单据、计划补货时间和非零退回数量 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-022/514-rm-022-purchase-replacement-validation.png) |
| DR-0059 | RM-023 | 第一遍列表 | 检查供应商价格本状态、统计和用途 | 价格本用于管理供应商报价协议、批量导入、多级折扣并沉淀议价成果；状态为草稿、生效中、已过期、已废弃 | 确认采购价不是物料单一字段，而是供应商协议化、可生效失效的独立版本数据 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-023/515-rm-023-supplier-pricebook-list.png) |
| DR-0060 | RM-023 | 第一遍空表单 | 打开新建供应商价格本 | 必填名称、供应商、币种，默认人民币；可设置生效/失效日期、一级和二级全局折扣、备注；净价按目录价连续乘两级折扣计算，新物料自动继承 | 确认价格本以供应商和币种为作用域，折扣是两级连乘且需保留有效期 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-023/516-rm-023-supplier-pricebook-empty-form.png) |
| DR-0061 | RM-023 | 第一遍校验 | 在空价格本弹窗点击“创建” | 价格本名称和供应商显示不能为空；币种已有默认；生效与失效日期当前未触发空值错误 | 确认创建草稿的最低显式必填为名称与供应商，日期策略需第二遍用真实数据验证 | [截图](../../../references/risemap-capture/deep/supply-chain/purchasing/rm-023/517-rm-023-supplier-pricebook-validation.png) |
