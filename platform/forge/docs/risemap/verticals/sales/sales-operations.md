# 销售 / 销售业务

当前发现 11 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-046 | 框架销售合同 | `https://risemap.cn/sales/contracts` | 框架销售合同 | 新建合同、导入/导出、刷新、范围、状态、订单状态、开票、发货、收款、负责人、客户联系人、上一页、1、下一页 | [截图](../../../references/risemap-capture/228-rm-046-loaded.png) | 首屏已采集，流程未验证 |
| RM-047 | 销售订单 | `https://risemap.cn/sales/orders` | 销售订单 | 下一步操作 销售发货单、订单列表、订单明细 0、新建销售订单、导入/导出、合并开票、刷新、范围、状态、开票、收款、发货建单、发货、负责人、客户联系人、上一页、1、下一页 | [截图](../../../references/risemap-capture/230-rm-047-loaded.png) | 首屏已采集，流程未验证 |
| RM-048 | 收款流水 | `https://risemap.cn/sales/collection-flow` | 收款流水 | 全部 (0)、待分配 (0)、部分分配 (0)、已分配 (0)、刷新、全部客户 | [截图](../../../references/risemap-capture/232-rm-048-loaded.png) | 首屏已采集，流程未验证 |
| RM-049 | 销售发货单 | `https://risemap.cn/sales/outbound` | 销售发货单 | 下一步操作 待出库发货单、新建发货单、导出、导出任务、刷新、状态、范围、上一页、1、下一页 | [截图](../../../references/risemap-capture/234-rm-049-loaded.png) | 首屏已采集，流程未验证 |
| RM-050 | 销售退货 | `https://risemap.cn/sales/returns` | 销售退货 | 新建退货、导出、导出任务、刷新、范围、状态、处理方式、上一页、1、下一页 | [截图](../../../references/risemap-capture/236-rm-050-loaded.png) | 首屏已采集，流程未验证 |
| RM-051 | 业绩银行 | `https://risemap.cn/sales/performance-bank` | 业绩银行 | 所有、我负责的、下属负责的、我关注的、我的业绩银行、业绩流水、Rebook 记录、销售业绩确认、业绩分析、选择业绩人、全部、本年、Q1、Q2、Q3、Q4、本月 | [截图](../../../references/risemap-capture/238-rm-051-loaded.png) | 首屏已采集，流程未验证 |
| RM-052 | 价格策略 | `https://risemap.cn/sales/pricing` | 价格策略 | 物料定价、价格组管理、框架协议价、特价审批、价格调整记录、价格历史、选中当前分组物料、批量调价、批量配置价格关系、分配价格组、批量导入、导入/导出任务、导出、刷新、全部部门、上一页、1、下一页 | [截图](../../../references/risemap-capture/240-rm-052-loaded.png) | 首屏已采集，流程未验证 |
| RM-053 | Goodwill订单 | `https://risemap.cn/sales/goodwill` | Goodwill订单 | 新建 Goodwill 订单、刷新、类型、状态、导出、导出任务、上一页、1、下一页 | [截图](../../../references/risemap-capture/242-rm-053-loaded.png) | 首屏已采集，流程未验证 |
| RM-054 | 销售团队 | `https://risemap.cn/sales/organization` | 销售组织管理 | 新建团队 | [截图](../../../references/risemap-capture/244-rm-054-loaded.png) | 首屏已采集，流程未验证 |
| RM-055 | 销售目标 | `https://risemap.cn/sales/target` | 销售目标管理 | 新建目标、个人目标、团队目标、2026年 | [截图](../../../references/risemap-capture/246-rm-055-loaded.png) | 首屏已采集，流程未验证 |
| RM-056 | 销售发票 | `https://risemap.cn/sales/invoices` | 销售发票 | 全部0、待审批0、已审批0、已开票0、已驳回0、已撤回0、导出、导出任务、刷新、上一页、1、下一页 | [截图](../../../references/risemap-capture/248-rm-056-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0165 | RM-046 | 第一遍列表 | 打开框架销售合同 | 合同表追踪客户单号、类型、客户、项目、来源、总额、开票/发货/回款、状态、下单笔数与金额、红绿灯、签订时间、负责人和联系人 | 确认框架合同是订单、交付、发票与回款的总控对象，并按履约红绿灯提示风险 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/621-rm-046-framework-contract-list.png) |
| DR-0166 | RM-046 | 第一遍表单 | 打开新建框架销售合同 | 合同分客户/负责人、基本信息、物料、订货约束、附加费用、收入确认、条款、附件和金额汇总；物料支持报价/特价/询价/粘贴/Excel/物料库/组合导入 | 确认框架合同同时定义商品与价格边界、关联公司授权、订单审批策略、收入确认和长期商务条款 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/622-rm-046-framework-contract-form.png) |
| DR-0167 | RM-046 | 第一遍配置依赖 | 展开合同类型 | 当前无合同类型数据，合同无法提交 | 确认合同类型是前置业务字典并可约束后续统计和审批 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/623-rm-046-contract-type-empty.png) |
| DR-0168 | RM-046 | 第一遍字典入口 | 打开新增合同类型 | 可现场新增合同类型名称和标识颜色 | 确认合同类型属于可配置字典，制单入口可快速补全 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/624-rm-046-contract-type-quick-add.png) |
| DR-0169 | RM-046 | 第一遍订货约束 | 启用合同总下单金额限制 | 出现含税总金额上限和同步当前物料金额；基于合同生成订单的累计含税金额不得超限 | 确认额度按累计下单金额控制，可从协议物料金额初始化 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/625-rm-046-contract-amount-limit.png) |
| DR-0170 | RM-046 | 第一遍订货约束 | 启用分/子公司或关联公司受用 | 出现关联单位、关系类型、可下单授权与备注，可追加多行 | 确认合同可授权关联法人引用，但授权需逐单位控制下单权限 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/626-rm-046-contract-affiliate-authorization.png) |
| DR-0171 | RM-046 | 第一遍订货约束 | 启用协议外物料与额度内审批 | 协议外物料始终须审批，并可要求额度/数量/清单范围内订单也审批；超限订单保留审批边界 | 确认合同支持白名单外例外采购和全量订单审批两种治理强度 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/627-rm-046-contract-approval-policy.png) |
| DR-0172 | RM-046 | 第一遍收入确认 | 展开收入确认触发方式 | 可选按发货出库、按开票、按里程碑（服务）、按周期、手动，销售订单默认继承且可单独调整 | 确认收入确认支持商品、票据、服务进度、订阅周期与人工判断五种模型 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/628-rm-046-revenue-trigger-options.png) |
| DR-0173 | RM-046 | 第一遍收入确认 | 选择按开票 | 收入在开票后按规则确认 | 确认票据驱动收入可与物流出库解耦 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/629-rm-046-revenue-by-invoice.png) |
| DR-0174 | RM-046 | 第一遍收入确认 | 选择按里程碑（服务） | 默认生成预付款30%、设备到场40%、项目终验30%，每节点含预估时间、验收方式和完成条件，合计100% | 确认服务/项目合同按可验收节点分摊收入，并强制比例闭合 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/630-rm-046-revenue-by-milestone.png) |
| DR-0175 | RM-046 | 第一遍收入确认 | 选择按周期 | 按合同起止时间和每月周期生成12期节点，各期含时间、金额和验收方式，并显示已分配/合同金额 | 确认订阅与服务合同按周期排程收入，需校验各期金额合计 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/631-rm-046-revenue-by-period.png) |
| DR-0176 | RM-046 | 第一遍收入确认 | 选择手动确认 | 收入仅在人工确认后入账，不自动随物流、开票或周期触发 | 确认复杂验收或例外合同可由授权人员手工决定收入时点 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/632-rm-046-revenue-manual.png) |
| DR-0177 | RM-046 | 第一遍校验 | 在空框架合同点击提交 | 系统阻止提交并标出客户、合同标题、合同类型及物料等必填项；未创建合同 | 确认客户、合同分类和有效明细是框架合同提交门槛，临时切换的约束未落库 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-046/633-rm-046-contract-validation.png) |
| DR-0178 | RM-047 | 第一遍列表 | 打开销售订单 | 订单表关联合同、客户、项目、特价、授信、付款条件、金额、开票/发货/收款进度、计划交期、负责人和联系人，并支持合并开票 | 确认销售订单是合同执行、信用控制、交付与应收的核心事务对象 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/634-rm-047-sales-order-list.png) |
| DR-0179 | RM-047 | 第一遍明细页 | 切换到订单明细 | 逐行展示物料、型号规格、订单/客户单号、日期、客户、数量、含税/未税价格、折扣、金额、计划交货、状态和负责人 | 确认订单明细提供价格、数量和交期的行级履约与对账视图 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/635-rm-047-sales-order-lines.png) |
| DR-0180 | RM-047 | 第一遍表单 | 打开新建销售订单默认直接新建 | 独立订单需客户、交期、负责人、有效物料、付款条件与方式；物料支持特价/报价/粘贴/Excel/主数据/组合导入和批量数量价格税率折扣；可用授信、附加费用、收入确认与附件 | 确认订单汇集客户信用、价格、税额、交付与收入规则，当前无付款方式是阻塞依赖 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/636-rm-047-sales-order-form.png) |
| DR-0181 | RM-047 | 第一遍来源分支 | 切换为关联合同 | 必须先选客户再选已签合同，订单引用合同价格、账期和规则；超合同总额或单品数量上限进入审批，物料待合同选定后加载 | 确认合同订单受合同额度、物料清单与审批策略约束，不能作为独立订单绕开 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/637-rm-047-order-from-contract.png) |
| DR-0182 | RM-047 | 第一遍结算分支 | 启用授信额度 | 订单金额将占用客户授信，按客户档案中的结算周期执行并提示可在客户详情修改 | 确认授信订单产生信用额度占用，账期来源于客户主数据 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/638-rm-047-order-credit-settlement.png) |
| DR-0183 | RM-047 | 第一遍校验 | 在空关联合同订单点击提交 | 系统阻止提交并标出客户、合同、计划交期、付款结算等必填项；未创建订单 | 确认合同订单仍需客户、有效合同和交付结算条件，授信开关不能绕开来源校验 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-047/639-rm-047-sales-order-validation.png) |
| DR-0184 | RM-048 | 第一遍流水列表 | 打开收款流水 | 汇总流水总额、已分配、未分配和待处理笔数；流水含客户、日期、方式、账户、金额和分配状态，可按单号/对方/金额/客户/日期筛选 | 确认银行收款先形成资金流水，再手工分配订单，核销前可解绑并刷新订单回款进度 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-048/640-rm-048-collection-flow-all.png) |
| DR-0185 | RM-048 | 第一遍状态页签 | 切换到待分配 | 仅显示尚未关联销售订单的收款流水 | 确认资金入账和应收核销是两个独立步骤 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-048/641-rm-048-collection-unallocated.png) |
| DR-0186 | RM-048 | 第一遍状态页签 | 切换到部分分配 | 显示一笔资金已分配部分、仍有余额的流水 | 确认单笔收款可拆分到多个订单或分次完成核销 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-048/642-rm-048-collection-partial.png) |
| DR-0187 | RM-048 | 第一遍状态页签 | 切换到已分配 | 显示已全部关联订单的流水 | 确认全额分配后进入完成集合，订单回款进度应同步更新 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-048/643-rm-048-collection-allocated.png) |
| DR-0188 | RM-049 | 第一遍列表 | 打开销售发货单 | 发货单关联合同订单与客户单号，追踪客户、收货人、状态、出库进度、含税金额、出库单和日期，并衔接待出库页 | 确认销售发货单把商业交付请求转换为仓库出库执行，并保留金额与客户交付上下文 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-049/644-rm-049-sales-shipment-list.png) |
| DR-0189 | RM-049 | 第一遍表单 | 打开新建销售发货单 | 先选客户，再可勾选多个销售订单合并发货；物料按订单分组，可逐订单填写本次发货量且不得超未发量；支持订单多次发货和发货单内分批出库 | 确认发货单支持多订单合并、部分发货与分批出库，数量上限来自订单未发余额 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-049/645-rm-049-sales-shipment-form.png) |
| DR-0190 | RM-049 | 第一遍校验 | 空发货单点击确认创建 | 系统阻止创建并要求客户和至少一个销售订单；未创建发货单 | 确认发货单必须有销售订单来源，不能手工构造无订单交付 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-049/646-rm-049-sales-shipment-validation.png) |
| DR-0191 | RM-050 | 第一遍列表 | 打开销售退货 | 退货单关联销售订单与客户，记录原因、处理方式、金额、状态和附件 | 确认退货同时影响库存回流、退款或换货和责任原因归集 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/647-rm-050-sales-return-list.png) |
| DR-0192 | RM-050 | 第一遍筛选 | 展开退货处理方式 | 处理方式为退货退款、仅退货、换货补发 | 确认同一退货实体覆盖资金退款、单纯库存回收和替换交付三类结果 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/648-rm-050-return-method-filter.png) |
| DR-0193 | RM-050 | 第一遍表单 | 打开新建销售退货单默认退货退款 | 可关联销售订单或不指定订单手填；关联时仅已发货物料可退且数量不超已发；要求客户、订单/手填、原因、处理方式，可选退回仓与退款方式，退款需审核 | 确认销售退货以已发数量为上限，退款、入库与审核需分别执行 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/649-rm-050-sales-return-form.png) |
| DR-0194 | RM-050 | 第一遍处理分支 | 选择仅退货 | 退货只执行商品回收，不生成退款或替换交付 | 确认可处理免费退回、借用品归还或无需退款的库存回流 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/650-rm-050-return-only-branch.png) |
| DR-0195 | RM-050 | 第一遍处理分支 | 选择换货补发 | 退回原物料后进入替换交付流程，不显示退款方式 | 确认换货不形成退款，但需保持退回和补发两条物流链关联 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/651-rm-050-return-exchange-branch.png) |
| DR-0196 | RM-050 | 第一遍校验 | 空换货退货单点击提交退货 | 系统阻止提交并要求客户、销售订单、退货原因及退货物料；未创建退货单 | 确认处理方式选择不能代替来源订单和有效退货数量校验 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-050/652-rm-050-sales-return-validation.png) |
| DR-0197 | RM-051 | 第一遍业绩银行 | 打开我的业绩银行 | 按已完成订单统计确认业绩、毛利、笔数和待审批，区分原始确认、业绩分入、业绩分出和净额，并展示月度趋势与计收比例 | 确认业绩只从完成订单沉淀，并允许通过分入分出形成可审计净额 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/653-rm-051-performance-bank.png) |
| DR-0198 | RM-051 | 第一遍范围 | 切换我负责的 | 按当前用户负责人身份筛选业绩 | 确认负责人归属决定原始业绩口径 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/654-rm-051-performance-mine.png) |
| DR-0199 | RM-051 | 第一遍范围 | 切换下属负责的 | 按组织下属负责人筛选业绩 | 确认管理者可审阅团队业绩而不改变归属 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/655-rm-051-performance-subordinates.png) |
| DR-0200 | RM-051 | 第一遍范围 | 切换我关注的 | 按当前用户关注关系筛选业绩 | 确认关注提供跨归属观察视图 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/656-rm-051-performance-following.png) |
| DR-0201 | RM-051 | 第一遍页签 | 打开业绩流水 | 流水按方向关联销售订单、客户、业绩人、订单额、业绩额、毛利率、状态和确认时间，支持导出及人/客户/日期筛选 | 确认业绩银行以不可丢失的方向流水计算余额，可审计每次确认和转移 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/657-rm-051-performance-entries.png) |
| DR-0202 | RM-051 | 第一遍页签 | 打开 Rebook 记录 | 提供业绩重分配记录独立页签和导出入口 | 确认业绩改归属通过 Rebook 留痕，不直接覆盖原始业绩流水 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/658-rm-051-performance-rebooks.png) |
| DR-0203 | RM-051 | 第一遍页签 | 打开销售业绩确认 | 提供待确认与已确认业绩页签 | 确认完成订单产生的业绩需独立确认后进入业绩银行 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/659-rm-051-performance-confirmation.png) |
| DR-0204 | RM-051 | 第一遍确认状态 | 切换待确认业绩 | 展示尚未确认的订单业绩候选 | 确认未确认业绩不计入最终业绩余额 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/660-rm-051-performance-pending-confirm.png) |
| DR-0205 | RM-051 | 第一遍确认状态 | 切换已确认业绩 | 展示已完成确认的业绩记录 | 确认确认动作形成可追溯完成集合 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/661-rm-051-performance-confirmed.png) |
| DR-0206 | RM-051 | 第一遍页签 | 打开业绩分析 | 可按年度/季度/月、团队/人员和回款或订单额口径筛选；月度趋势可看业绩额、订单额、回款额、毛利、完成率，并提供人员排名和团队完成率 | 确认业绩分析同时比较成交、回款、毛利和目标完成，支持团队与个人管理口径 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-051/662-rm-051-performance-analytics.png) |
| DR-0207 | RM-052 | 第一遍页签 | 打开价格策略的物料定价 | 按物料与部门/分类/价格组维护成本价、最低售价、建议售价和目录价，支持批量调价、价格关系、分组、导入导出 | 确认销售价格存在成本、底价、建议价和目录价四层控制，可批量治理 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/663-rm-052-material-pricing.png) |
| DR-0208 | RM-052 | 第一遍页签 | 打开价格组管理 | 左侧维护价格组并区分未分配物料，选择组后配置其物料 | 确认价格组承载客户或渠道差异化价格分层，并需追踪未归组物料 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/664-rm-052-price-groups.png) |
| DR-0209 | RM-052 | 第一遍配置表单 | 打开新建价格组 | 价格组要求名称，可填写描述 | 确认价格组是独立主数据，可供物料和客户定价关系引用 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/665-rm-052-new-price-group.png) |
| DR-0210 | RM-052 | 第一遍页签 | 打开框架协议价 | 协议按客户、联系人、生效/到期、物料数量、协议总额、创建人和状态管理，并区分生效、过期、待审批、终止与即将到期 | 确认客户专属协议价具有有效期、审批和终止生命周期 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/666-rm-052-framework-agreement-prices.png) |
| DR-0211 | RM-052 | 第一遍配置表单 | 打开新建框架协议价 | 要求客户、生效/到期日期，可备注；协议物料可逐个或按价格组批量添加，流程为草稿后提交审批 | 确认协议价面向客户且需审批，价格组可批量生成协议清单 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/667-rm-052-framework-agreement-form.png) |
| DR-0212 | RM-052 | 第一遍有效期分支 | 启用长期有效 | 协议取消结束时间限制 | 确认长期协议用显式标志替代伪造远期日期 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/668-rm-052-agreement-long-term.png) |
| DR-0213 | RM-052 | 第一遍校验 | 空框架协议点击提交审批 | 系统阻止提交并要求客户、生效日期和协议物料；未创建协议 | 确认长期有效仍不能绕过客户、生效日和有效物料清单 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/669-rm-052-agreement-validation.png) |
| DR-0214 | RM-052 | 第一遍页签 | 打开特价审批 | 特价区分草稿、审批中、通过、驳回、撤回与普通/加急/特急；记录来源报价、正常价、申请价、让利金额、申请人和时间 | 确认低于常规价格的让利通过独立申请、紧急度和审批生命周期治理 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/670-rm-052-special-price-approvals.png) |
| DR-0215 | RM-052 | 第一遍配置表单 | 打开新建特价申请 | 要求客户、申请物料和申请理由，可选普通/加急/特急、来源报价单与辅助材料；支持从报价导入或手工添加物料 | 确认特价申请必须说明客户、具体让利物料和商业理由，并可附审价证据 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/671-rm-052-special-price-form.png) |
| DR-0216 | RM-052 | 第一遍校验 | 空特价申请点击提交审核 | 系统阻止提交并要求客户、物料和申请理由；未创建申请 | 确认紧急度不能绕过让利对象和理由校验 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/672-rm-052-special-price-validation.png) |
| DR-0217 | RM-052 | 第一遍页签 | 打开价格调整记录 | 记录调整编号、版本号、类型、状态、原因、物料、创建人和时间，并区分草稿、审批中、通过、驳回、撤回 | 确认批量调价形成有版本和审批状态的变更单，避免直接覆盖当前价 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/673-rm-052-price-adjustment-records.png) |
| DR-0218 | RM-052 | 第一遍页签 | 打开价格历史 | 按报价、成交、特价、框架协议价记录物料、品牌、客户、报价/成交单价与数量、日期、业务员和备注，并汇总物料、记录、成交与待跟进报价 | 确认历史价格按客户与交易阶段沉淀，可用于定价参考和报价转化分析 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-052/674-rm-052-price-history.png) |
| DR-0219 | RM-053 | 第一遍列表 | 打开 Goodwill 订单 | 用于客情维护、补偿赠送等无偿订单，记录客户、赠送类型、原因、物品种类/总数、状态、负责人和创建人 | 确认无收入交付通过独立订单与审批追踪，避免混入普通销售业绩 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-053/675-rm-053-goodwill-list.png) |
| DR-0220 | RM-053 | 第一遍筛选 | 展开 Goodwill 类型 | 当前租户没有可用赠送类型 | 确认 Goodwill 类型依赖业务配置，需在第二遍创建真实字典后再执行 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-053/676-rm-053-goodwill-type-empty.png) |
| DR-0221 | RM-053 | 第一遍表单 | 打开新建 Goodwill 订单 | 明确不涉及付款，提交后审批再发货；要求客户、负责人、赠送类型、原因和物品清单，可关联合同/项目；物品含名称、数量和备注 | 确认免费赠送通过审批与发货执行，但不进入收款流程，物品可不限于库存销售物料 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-053/677-rm-053-goodwill-form.png) |
| DR-0222 | RM-053 | 第一遍字典入口 | 打开新增赠送类型 | 赠送类型可维护名称与标识颜色 | 确认 Goodwill 分类是可配置业务字典 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-053/678-rm-053-goodwill-type-quick-add.png) |
| DR-0223 | RM-053 | 第一遍校验 | 空 Goodwill 订单点击创建 | 系统阻止创建并要求客户、负责人、赠送类型、申请原因和有效物品；未创建订单 | 确认无偿订单仍需完整业务理由、归属和物品清单 | [截图](../../../references/risemap-capture/deep/sales/sales-operations/rm-053/679-rm-053-goodwill-validation.png) |
| DR-0224 | RM-054 | 列表空态 | 打开销售组织管理 | 销售团队为空，可按团队结构搜索并新建团队 | 销售目标和客户分配依赖团队层级与成员归属 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-054/680-rm-054-team-list.png) |
| DR-0225 | RM-054 | 新建表单 | 打开新建销售组织 | 字段含团队名称、组织上级、负责人和描述；首个团队只能建顶级组织 | 组织树支持上下级销售区域，负责人是团队治理必填项 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-054/681-rm-054-team-form.png) |
| DR-0226 | RM-054 | 负责人选择 | 展开负责人选择器 | 可搜索当前员工，候选展示姓名、部门与系统角色 | 销售组织负责人绑定内部员工并继承组织权限 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-054/682-rm-054-team-owner.png) |
| DR-0227 | RM-054 | 空提交校验 | 不填写内容直接确定 | 团队名称和负责人分别就地提示不能为空，并提示检查必填项 | 组织主数据不能生成无名称或无负责人节点 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-054/683-rm-054-team-validation.png) |
| DR-0228 | RM-055 | 个人目标空态 | 打开销售目标个人视图 | 默认年份 2026，个人目标暂无数据 | 目标按自然年度和销售成员维度管理并计算完成进度 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/684-rm-055-target-personal.png) |
| DR-0229 | RM-055 | 团队目标空态 | 切换团队目标 | 团队目标暂无数据，与个人目标分成独立视图 | 团队目标依赖销售组织并可用于逐层汇总 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/685-rm-055-target-team.png) |
| DR-0230 | RM-055 | 年份筛选 | 展开年度选择器 | 可选 2024 至 2029 年并可搜索 | 目标支持跨年度规划和历史对比 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/686-rm-055-target-year.png) |
| DR-0231 | RM-055 | 团队目标表单 | 从团队目标视图新建目标 | 目标含合同额、回款额、12 个月月度分配及备注；当前默认团队类型 | 销售目标同时约束签约与现金回收，并保留月度节奏 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/687-rm-055-target-team-form.png) |
| DR-0232 | RM-055 | 团队依赖 | 展开团队对象选择 | 销售组织为空时选择器明确显示暂无数据 | 团队目标必须先建立销售团队，避免孤立目标 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/688-rm-055-target-no-team.png) |
| DR-0233 | RM-055 | 个人目标分支 | 切换为个人目标 | 目标对象字段由团队切换为人员，金额与月度结构保持一致 | 同一目标模型支持人员与团队两个核算粒度 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/689-rm-055-target-individual-form.png) |
| DR-0234 | RM-055 | 人员依赖 | 展开个人目标人员选择 | 未配置销售组织成员时选择器显示暂无数据 | 个人目标对象来源于销售组织成员而非任意系统用户 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/690-rm-055-target-no-person.png) |
| DR-0235 | RM-055 | 平均分配 | 输入合同额 120000 和回款额 60000 后平均分配 | 合同额每月 10000，回款每月 5000；展示回款合同额比 50% 和合计对账 | 系统自动保持年度目标、月度目标和两项目标间比率一致 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/691-rm-055-target-average.png) |
| DR-0236 | RM-055 | 对象校验 | 保留有效金额但不选择人员后创建 | 人员字段提示请选择人员并阻止创建 | 完整金额计划不能绕过核算对象约束 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-055/692-rm-055-target-validation.png) |
| DR-0237 | RM-056 | 全部申请 | 打开销售发票全部列表 | 当前 0 笔，价税合计 0；列表含申请号、客户/销售方、模式、合并订单、价税合计、状态、关联发票 | 销售侧跟踪开票申请，正式发票由财务登记回写 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/693-rm-056-invoice-all.png) |
| DR-0238 | RM-056 | 待审批 | 切换待审批 | 待审批申请为 0 | 提交后的开票申请进入审批队列 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/694-rm-056-invoice-pending.png) |
| DR-0239 | RM-056 | 已审批 | 切换已审批 | 已审批申请为 0 | 审批通过后等待财务正式开票 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/695-rm-056-invoice-approved.png) |
| DR-0240 | RM-056 | 已开票 | 切换已开票 | 已开票申请为 0 | 财务回写发票后销售侧闭环为已开票 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/696-rm-056-invoice-issued.png) |
| DR-0241 | RM-056 | 已驳回 | 切换已驳回 | 已驳回申请为 0 | 审批驳回后保留申请记录和原因追踪入口 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/697-rm-056-invoice-rejected.png) |
| DR-0242 | RM-056 | 已撤回 | 切换已撤回 | 已撤回申请为 0 | 申请人在审批前可撤回并保留审计状态 | [截图](../../../references/risemap-capture/deep/sales/sales-ops/rm-056/698-rm-056-invoice-withdrawn.png) |
