# 服务管理页面合同（RISEMAP 当前结构对照）

本轮范围：销售下的服务管理分组，包括服务工单、服务报价单、服务结算单、接单中心、派工中心、服务分析、质保管理、服务配置。对照账号：RISEMAP `金一涛` 与 Forge `Dev Admin` 按同一业务用户对照。

## RISEMAP 当前事实

服务工单入口为 `https://risemap.cn/after-sales/orders`，标题“服务工单”，说明为“统一管理客户报修、安装调试、巡检保养、备件更换和有偿服务”。首屏有“下一步操作 派工中心”，筛选包含工单号/客户/SN/型号/联系人、全部类型、全部紧急度、全部状态；表头为工单信息、客户信息、服务对象、服务属性、状态、负责人、时效信息、操作；当前为空态“当前筛选下暂无工单”。

服务报价单入口为 `https://risemap.cn/after-sales/quotations`，标题“服务报价单”，说明为“集中管理服务报价、客户确认和报价转结算”。首屏包含新增服务报价单、搜索、全部状态，当前为空态“暂无符合条件的报价单”。

服务结算单入口为 `https://risemap.cn/after-sales/settlements`，标题“服务结算单”，说明为“集中管理服务费用核算、审批、客户确认与财务应收衔接”。首屏包含从完工工单新建、搜索、全部状态，当前为空态“暂无符合条件的结算单”。

接单中心入口为 `https://risemap.cn/after-sales/my-workspace`，标题“接单中心”，说明为“今日行程、我的工单、业绩、备件与报价单”。当前账号提示还没有关联服务人员档案；指标包含今日计划上门、待接单、进行中、今日已完工、超时工单；页签包含今日、我的工单、业绩、我的备件、我的报价单、我的结算单。

派工中心入口为 `https://risemap.cn/after-sales/dispatch`，标题“派工中心”，说明为“集中处理待分派工单，结合工程师负载、区域与技能完成调度”。首屏包含服务工单入口、待分派、派工日历、资源负载、SLA 监控；指标包含待分派工单、紧急/停机、已超时、今日新增；筛选包含工单号/客户/标题、全部地区、全部类型、全部紧急度；当前为空态“当前筛选下暂无待分派工单”。

服务分析入口为 `https://risemap.cn/after-sales/stats`，标题“服务分析”，说明为“按人 / 客户 / 类型 / 时间 / 区域多维透视，含期间对比、经营摘要与质量预警”。首屏包含时间筛选、地区、团队、计费、类型、紧急度和售后主管/工程师/财务视角；指标包含工单总量、SLA 达标率、一次解决率、平均响应/处理、客户满意度、服务收入、服务毛利、问题解决率。

质保管理入口为 `https://risemap.cn/after-sales/warranty`，标题“质保管理”，说明为“质保卡台账、到期预警、激活与延保，以及质保规则配置”。首屏包含服务工单入口、概览/质保卡/质保规则，指标包含生效中、待激活、宽限期、已过保、已终止，并展示 30/60/90 天到期、按来源、按判定粒度、按责任方等空态。

服务配置入口为 `https://risemap.cn/after-sales/config`，标题“服务配置”，说明为“工单类型、状态、质保、SLA、费用目录、付款模板与服务人员统一配置”。首屏页签包含工单类型、状态与紧急度、质保规则、SLA 规则、费用类型、付款模板、服务人员、报价设置、客户门户；当前工单类型为空。

## Forge 当前表现

Forge 已在销售导航下新增“服务管理”分组，并为 8 个服务入口建立独立业务页面和轻量业务对象。页面按 RISEMAP 当前事实呈现标题、说明、下一步入口、筛选、指标、页签、表头和空态；由于当前 RISEMAP 账号服务数据为空且接单中心缺少服务人员档案，本轮不把新建工单、派工、报价转结算、质保激活和配置新增写成已完成办理路径。

## 证据材料

- RISEMAP：`docs/references/risemap-capture/live/20260913-sales-full/risemap-sales-服务工单.*`、`risemap-sales-服务报价单.*`、`risemap-sales-服务结算单.*`、`risemap-sales-接单中心.*`、`risemap-sales-派工中心.*`、`risemap-sales-服务分析.*`、`risemap-sales-质保管理.*`、`risemap-sales-服务配置.*`
- Forge：`docs/references/risemap-capture/live/20260913-sales-full/forge-service-orders.*`、`forge-service-quotations.*`、`forge-service-settlements.*`、`forge-service-workspace.*`、`forge-service-dispatch.*`、`forge-service-analysis.*`、`forge-warranty-management.*`、`forge-service-config.*`

## 验收结论

当前可验收范围是服务管理 8 个入口的导航、首屏、指标、筛选、表头、下一步入口和空态结构。服务人员建档、工单派发、工程师接单、报价确认、结算生成应收、质保激活和服务配置新增仍需 RISEMAP 同材料办理后继续复核。

## 2026-09-13 同材料补证：服务工单办理链

RISEMAP 已在已登录账号中新增对照数据并完成办理到“服务中”：

- 服务配置新增工单类型 `RISEMAP 对照服务类型 20260913`，编码 `RMTESTSERVICE0913`。
- 服务配置新增服务人员 `RISEMAP 对照服务工程师 20260913`，电话 `13800000913`，团队 `售后对照组`，区域 `苏州 / 远程`，技能 `PLC、调试`，状态 `在岗`。
- 服务工单 `WO-2026-0001`，标题 `RISEMAP 对照服务工单 20260913`，客户 `苏州澄岳自动化装备有限公司`，联系人 `周启明 13800002609`，来源销售订单 `SO-2026-0001`，来源合同 `SC-OEM-20260909-001`，服务方式 `上门服务`，紧急度 `中`，服务地址 `苏州澄岳自动化装备有限公司现场`，问题描述为 `800型柔性线控制柜交付后例行调试支持，用于 Forge 同材料复刻验收。`，故障现象 `PLC 通讯参数复核`，影响范围 `单工位调试支持`。
- RISEMAP 状态流转已观察为：提交后 `待受理`，受理后 `待分派`，派工后 `待接单`，工程师接单后 `服务中`。服务中页面露出 `处理记录`、`预约客户`、`到场签到`、`挂起`、`升级协同`、`提交服务结果`。
- 质保判定显示 `未配置质保`，报价和结算当前为待后续处理；这是 RISEMAP 当前页面事实，不用 Forge 自行补成已收费或已结算。

Forge 已按同材料补齐本地可办理链：

- 服务配置页回读同名工单类型和服务人员，分类显示为 `工单类型`、`服务人员`，状态显示为 `启用`。
- 服务工单页支持新建弹窗、提交前二次确认、受理确认、派工弹窗、工程师接单确认。
- Forge 本地工单 `WO-FORGE-20260913` 使用同一客户、联系人、电话、服务类型、服务方式、紧急度、质保日期、问题描述、故障现象、影响范围和服务工程师。Forge 本地现有销售订单为 `SO-WF-20260909-001`，本地合同为 `SC-CONVERT-20260909-001`，业务上对应 RISEMAP `SO-2026-0001` / `SC-OEM-20260909-001` 的同一对照材料，编号差异单独记录，不作为字段缺失。
- Forge 已通过页面操作流转到 `服务中`，列表显示下一步 `处理记录 / 到场签到 / 提交服务结果`，派工中心回读同一工单、状态 `服务中` 和服务工程师。

新增证据目录：`docs/references/risemap-capture/live/20260913-sales-data/`。

关键证据文件：

- RISEMAP：`risemap-service-config-staff.*`、`risemap-service-order-form.*`、`risemap-service-order-after-submit.*`、`risemap-service-dispatch-dialog.*`、`risemap-service-dispatched.*`、`risemap-service-accepted.*`、`risemap-service-in-progress-current.*`。
- Forge：`forge-service-config-seeded.*`、`forge-service-order-form.*`、`forge-service-order-confirm.*`、`forge-service-order-created.*`、`forge-service-accept-dialog.*`、`forge-service-accepted.*`、`forge-service-dispatch-dialog.*`、`forge-service-dispatched.*`、`forge-service-receive-dialog.*`、`forge-service-in-progress.*`、`forge-service-order-final.*`、`forge-service-dispatch-page.*`、`forge-service-config-page.*`。

服务工单最小闭环结论：服务配置、工单创建、受理、派工、工程师接单和服务中承接已经形成 RISEMAP 与 Forge 的同材料页面对照闭环。服务结果提交、服务报告、报价转结算、结算生成应收、质保卡建档与激活仍未在 RISEMAP 同材料完成，继续保留为待复核功能。

## 2026-09-14 服务终态与按钮可用性补证

RISEMAP 当前实时页面补证：

- 服务工单详情 `https://risemap.cn/after-sales/orders/2099134912170762242` 显示工单 `WO-2026-0001`，状态为 `服务中`，可见动作包含 `处理记录`、`预约客户`、`到场签到`、`挂起`、`升级协同`、`提交服务结果`。
- 直接点击 `提交服务结果` 会被 RISEMAP 阻断，提示 `请至少填写一条处理记录后再提交服务结果`。
- 新增处理记录弹窗字段包含 `处理方式`、`服务耗时（小时）`、`现场处理图片`、`处理结果`、`问题原因`、`解决方案`，并默认勾选 `本次处理已解决问题`。
- 不上传现场图片时保存处理记录会被 RISEMAP 阻断，提示 `请至少上传一张现场处理图片`。上传文件到 RISEMAP 需单独确认，本轮没有上传文件，因此 RISEMAP 工单终态仍保留为待上传附件后继续复核。
- 服务报价单页 `https://risemap.cn/after-sales/quotations` 当前为空态 `暂无符合条件的报价单`，主入口为 `新增服务报价单`。
- 服务结算单页 `https://risemap.cn/after-sales/settlements` 当前为空态 `暂无符合条件的结算单`，主入口为 `从完工工单新建`。
- 质保管理页 `https://risemap.cn/after-sales/warranty` 当前质保卡为 0，概览包含 `生效中`、`待激活`、`宽限期`、`已过保`、`已终止` 等指标。

Forge 修正结论：

- 服务工单的 `提交服务结果` 动作新增 `服务耗时（小时）`、`处理记录`、`现场处理图片数`、`服务结果` 四项输入，并用业务文案阻断空处理记录、无现场图片数和无服务结果。
- 服务工单页把服务中行的 `提交服务结果` 从说明文字改成可点击按钮；未完成复核的 `处理记录` 和 `预约客户` 不再伪装成禁用按钮，改为说明文本。
- 已完工工单在操作列显示可执行的 `生成报价`、`生成结算`、`生成质保`；动作完成后改为 `已生成报价`、`已生成结算`、`已生成质保` 文本，避免留下不可点击的假按钮。
- 新增 `从完工工单新建结算` 动作，按 RISEMAP 服务结算单页面入口从已完工工单直接生成服务结算单；报价转结算保留为 Forge 可写扩展，不作为 RISEMAP 已观察事实。

按钮可用性证据写入 `docs/references/risemap-capture/live/20260913-sales-current-db/`，关键文件包括：

- `risemap-service-order-detail-initial-20260913.*`
- `risemap-service-submit-result-dialog-20260913.*`
- `risemap-service-treatment-record-after-save-attempt-20260913.*`
- `risemap-service-quotations-current-final-20260913.*`
- `risemap-service-settlements-current-clicked-20260913.*`
- `risemap-service-warranty-overview-current-20260913.*`
- `forge-service-complete-dialog-usability-fixed-20260913.*`
- `forge-service-after-browser-complete-final-visible-20260914.*`
- `forge-service-settlement-from-order-visible-readback-20260914.*`
- `forge-service-quote-visible-readback-20260914.*`
- `forge-service-warranty-visible-readback-20260914.*`

## 2026-09-14 控件真实可用性复查

本轮按“控件是否符合真实产品布局与人类使用习惯、按钮是否真实可办”重新检查服务链。

### RISEMAP 当前事实

- 已在内置浏览器重新打开 `https://risemap.cn/after-sales/orders/2099134912170762242`。
- 服务工单详情仍显示 `WO-2026-0001`，状态 `服务中`；标题状态区可见 `处理记录`、`预约客户`、`到场签到`、`挂起`、`升级协同`、`提交服务结果`。
- 详情页下方可见 `概览`、`处理记录`、`工时`、`团队`、`成本费用`、`报价和结算单`、`备件申请`、`服务报告`、`客户反馈`、`回访`、`操作日志`。此前已观察到服务结果提交受“处理记录”和“现场处理图片”阻断；线上附件上传仍未执行。

### Forge 当前表现与修正

- 复查 `page_service_orders` 时发现一次真实缺陷：提交服务结果后服务端已把工单写为 `completed`，页面却短暂显示“服务中”并禁用提交按钮。已修正动作成功后的即时行状态合并与刷新策略，避免“成功提示 + 旧状态/禁用按钮”的错觉。
- 服务工单页面重新通过内置浏览器办理：`WO-FLOW-20260913155707` 从 `服务中` 提交服务结果后回读为 `已完工`，后续动作显示为 `生成报价`、`生成结算`、`生成质保`。
- `生成报价`、`生成结算`、`生成质保` 均通过页面弹窗确认并生成对应记录；完成后操作列改为 `已生成报价`、`已生成结算`、`已生成质保` 文本，不保留不可点击假按钮。
- 复查 `page_service_quotations` 时发现操作列仅显示空值，页面可读但不能继续办理。已补为真实行操作：草稿报价显示 `确认报价`，已确认报价显示 `转结算`，已转结算显示文本。
- 复查 `page_service_settlements` 时发现操作列仅显示空值，页面可读但不能继续办理。已补为真实行操作：草稿结算显示 `确认结算`，已确认结算显示 `生成应收`，已生成应收显示文本并展示真实应收单号。
- 通用 CRM/服务页面里尚未实现真实筛选逻辑的页签不再渲染为按钮，改为非按钮视图标签；服务工单页保留可点击页签，因为其会真实过滤列表。

### 本轮页面验收结果

- 服务工单：提交服务结果、生成报价、生成结算、生成质保均完成页面点击、弹窗确认、反馈和列表回读。
- 服务报价单：草稿报价 `SQ-20260913163609` 通过页面确认为 `已确认`，再通过页面转为 `已转结算`。
- 服务结算单：结算单 `SS-20260913163831` 通过页面确认为 `已确认`，再通过页面生成应收，财务应收列回读 `AR-SVC-20260913163858`。
- RISEMAP 线上服务工单因现场图片上传仍未执行，线上终态仍标为待上传附件后复核；Forge 本地服务后续流转为可写执行扩展，不能冒充 RISEMAP 线上已闭环。

## 2026-09-14 本轮控件可用性门禁状态

本轮新增的页面可用性要求是：按钮和控件必须符合实际业务办理顺序与人类使用习惯，不能只做到字段可见或接口能通。服务链已经保留真实可执行的提交、生成报价、生成结算、生成质保、确认报价、转结算、确认结算和生成应收；未实现或需前置来源的能力改为业务说明，不再显示为按钮。

工程复查结果：`acceptance:sales-service-control-usability` 通过，未发现销售、Goodwill、CRM、服务页面存在惰性按钮、假页签、空点击处理或浏览器原生弹窗。本轮内置浏览器被本机锁屏和浏览器请求策略阻断，未能重新打开 RISEMAP 与 Forge 页面，因此服务后续流转的页面闭环仍以此前已保存页面证据为准；若继续改动服务页，必须再次做实时页面点击和回读。

## 2026-09-14 服务工单控件布局与真实可用性复查

- RISEMAP 当前事实：已登录内置浏览器打开 `https://risemap.cn/after-sales/orders`。销售分类下存在 `服务管理` 分组，入口包含 `服务工单`、`服务报价单`、`服务结算单`、`接单中心`、`派工中心`、`服务分析`、`质保管理`、`服务配置`。服务工单列表首屏包含 `下一步操作 派工中心`、类型 / 紧急度 / 状态筛选、`新建服务工单`、`刷新`、列表列 `工单信息`、`客户信息`、`服务对象`、`服务属性`、`状态`、`负责人`、`时效信息`、`操作`。
- RISEMAP 新建页事实：点击 `新建服务工单` 进入独立办理页 `https://risemap.cn/after-sales/orders/new`，页面按 `服务需求`、`客户与产品`、`质保信息`、`费用与报价`、`问题 / 服务内容` 分组，底部操作为 `取消`、`保存草稿`、`提交工单`。
- Forge 当前差异与处理：Forge 原先 `新建服务工单` 是列表工具栏里的按钮，实际浏览器点击后没有打开办理表单。已改为可达页面入口 `page_service_orders?mode=new`，并在新建页中按 RISEMAP 的五段办理结构组织字段；提交前使用 ObjectStack 标准确认弹窗，提交成功后返回列表。
- Forge 实际办理结果：内置浏览器完成 `新建服务工单 → 提交确认 → 待受理 → 受理 → 待分派 → 派工 → 待接单 → 工程师接单 → 服务中 → 提交服务结果 → 已完工 → 生成服务报价 → 生成服务结算 → 生成质保`。同一工单 `WO-FORGE-20260914014356` 的状态、下一步和承接按钮均在页面回写。
- 控件可用性结论：服务工单主入口不再是不可用按钮；关键行操作均有标准二次弹窗、业务影响说明和操作后状态变化。`金一涛` 与 `Dev Admin` 按同一业务用户对照，不作为身份差异。
- 证据：`docs/references/risemap-capture/live/20260914-service-order-usability/risemap-service-order-new.ax.txt`、`docs/references/risemap-capture/live/20260914-service-order-usability/risemap-service-order-new.png`、`docs/references/risemap-capture/live/20260914-service-order-usability/forge-service-order-created.ax.txt`、`docs/references/risemap-capture/live/20260914-service-order-usability/forge-service-order-created.png`、`docs/references/risemap-capture/live/20260914-service-order-usability/forge-service-order-completed-followups.ax.txt`、`docs/references/risemap-capture/live/20260914-service-order-usability/forge-service-order-completed-followups.png`。

## 2026-09-14 服务报价单控件可用性复查

- RISEMAP 当前事实：已登录内置浏览器打开 `https://risemap.cn/after-sales/quotations` 和 `https://risemap.cn/after-sales/quotations/new`。服务报价单列表主按钮为 `新增服务报价单`；新建页先选择 `关联服务工单`，再维护报价清单和报价条款，底部动作为 `取消`、`保存草稿`、`保存并发送`。
- Forge 当前表现：服务报价单列表可展示工单号、客户、联系人、报价金额、状态、有效期与行操作；草稿单可 `确认报价`，已确认单可 `转结算`，二者均使用标准确认弹窗并回写状态。
- 本轮处理：将顶部说明从类似入口占位的 `新增服务报价单：请从对应业务单据发起` 改为 `新增报价请在已完工服务工单中生成，列表用于客户确认和转结算`，避免把尚未复刻的直接新增能力包装成按钮或入口。
- 浏览器实操：同一报价单 `SQ-20260913174536` 已在 Forge 页面完成 `确认报价 → 转服务结算`，状态回写为 `已转结算`。
- 剩余差异：RISEMAP 支持从服务报价单列表直接进入独立新建页并维护报价清单；Forge 当前可办理路径是从已完工服务工单生成报价，直接新增报价页仍未补齐，保持为待实现差异。
- 证据：`docs/references/risemap-capture/live/20260914-service-quotation-usability/risemap-service-quotation-new.ax.txt`、`docs/references/risemap-capture/live/20260914-service-quotation-usability/risemap-service-quotation-new.png`、`docs/references/risemap-capture/live/20260914-service-quotation-usability/forge-service-quotation-transferred.ax.txt`、`docs/references/risemap-capture/live/20260914-service-quotation-usability/forge-service-quotation-transferred.png`。

## 2026-09-14 服务结算单页面可用性补验

- 本轮实际打开 RISEMAP：`https://risemap.cn/after-sales/settlements`。
- 本轮实际打开 Forge：`http://localhost:4321/_console/apps/forge/page/page_service_settlements`。
- RISEMAP 当前事实：服务结算单位于销售分类的服务管理分组，列表标题为 `服务结算单`，说明为 `集中管理服务费用核算、审批、客户确认与财务应收衔接`；当前列表为空态 `暂无符合条件的结算单`，主入口为 `从完工工单新建`，点击后回到服务工单列表选择来源。
- Forge 当前表现：服务结算单列表显示结算单号、工单号、客户、联系人、结算金额、状态、财务应收和操作；未实现直接空白新建页，页面说明为 `新增结算请从已完工工单或已确认服务报价生成，列表用于确认和财务应收`。
- 本轮发现的真实可用性问题：结算单 `SS-20260913174545` 点击 `生成应收` 能打开标准二次确认弹窗，但提交后因历史结算记录缺少负责人而失败，提示 `负责人不能为空`；用户在弹窗中无字段可补，属于按钮真实不可用。
- 本轮修正：服务结算生成应收时按 `结算负责人 -> 当前操作人` 补齐应收负责人；从服务工单或服务报价生成结算时也按来源负责人或当前操作人补齐负责人，保证历史数据和新数据都能继续办理。
- Forge 浏览器实操：同一结算单 `SS-20260913174545` 再次点击 `生成应收`，弹出 `生成服务应收`，确认后页面提示 `服务应收已生成`；列表回读状态为 `已生成应收`，财务应收回写 `AR-SVC-20260913175350`。
- 当前结论：服务结算单的确认结算和生成应收行操作已经完成页面点击、二次弹窗、提交反馈和状态回读；RISEMAP 当前只验证到 `从完工工单新建` 的入口语义，线上结算终态仍待有完工工单材料后继续复核。
- 证据：`docs/references/risemap-capture/live/20260914-service-settlement-usability/risemap-service-settlement-list.ax.txt`、`docs/references/risemap-capture/live/20260914-service-settlement-usability/risemap-service-settlement-list.png`、`docs/references/risemap-capture/live/20260914-service-settlement-usability/forge-service-settlement-receivable-created.ax.txt`、`docs/references/risemap-capture/live/20260914-service-settlement-usability/forge-service-settlement-receivable-created.png`。

## 2026-09-14 派工中心与接单中心页面可用性补验

- 本轮实际打开 RISEMAP：`https://risemap.cn/after-sales/dispatch`，并从 RISEMAP 左侧服务管理菜单进入 `接单中心`，实际地址为 `https://risemap.cn/after-sales/my-workspace`。
- RISEMAP 派工中心当前事实：页面标题为 `派工中心`，说明为 `集中处理待分派工单，结合工程师负载、区域与技能完成调度`；首屏包含 `待分派`、`派工日历`、`资源负载`、`SLA 监控` 视图，指标包含待分派工单、紧急 / 停机、已超时、今日新增；筛选包含全部地区、全部类型、全部紧急度；当前无待分派数据时 `批量派工` 禁用。
- RISEMAP 接单中心当前事实：入口实际进入服务人员工作台，标题为 `接单中心`，说明为 `今日行程、我的工单、业绩、备件与报价单`；首屏指标包含今日计划上门、待接单、进行中、今日已完工、超时工单；视图包含今日、我的工单、业绩、我的备件、我的报价单、我的结算单。
- Forge 发现的真实可用性问题：`page_service_dispatch` 原先列出大量已完成工单，指标为 0，操作列为空，用户无法从派工中心办理派工；`page_service_workspace` 原先默认混入大量已完工工单，不符合接单工作台的办理习惯。
- 本轮修正：派工中心默认只展示 `待分派` 工单，指标按当前数据计算，行操作提供真实 `派工` 二次弹窗；接单中心默认只展示 `待接单` 和 `服务中` 工单，行操作提供真实 `接单` 和 `提交服务结果` 弹窗，已完工数量保留为指标而不是主办列表噪音。
- Forge 浏览器实操：本地当前库创建 `WO-DISPATCH-20260913180046` 和 `WO-RECEIVE-20260913180046` 两条分入口回归材料。`WO-DISPATCH-20260913180046` 在派工中心显示为 `待分派`，点击 `派工` 后进入标准弹窗，确认后提示 `服务工单已派工，等待工程师接单`，并从待分派列表移除。随后在接单中心可见待接单工单，点击 `接单` 后变为 `服务中`，再点击 `提交服务结果` 并确认后提示 `服务工单已完工`，从可办列表移除。
- 当前结论：派工中心和接单中心已经从只读泛表收敛为符合 RISEMAP 职责的可办工作台；批量派工、派工日历、资源负载、SLA 监控和备件/报价/结算子视图仍按入口事实记录，未做完整 RISEMAP 同材料终态复核。
- 证据：`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/risemap-dispatch-current.ax.txt`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/risemap-dispatch-current.png`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/risemap-workspace-current.ax.txt`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/forge-dispatch-after-ui-dispatch.ax.txt`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/forge-dispatch-after-ui-dispatch.png`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/forge-workspace-after-complete.ax.txt`、`docs/references/risemap-capture/live/20260914-service-dispatch-workspace-usability/forge-workspace-after-complete.png`。

## 2026-09-14 质保管理页面可用性补验

- 本轮实际打开 RISEMAP：`https://risemap.cn/after-sales/warranty`。
- 本轮实际打开 Forge：`http://localhost:4321/_console/apps/forge/page/page_warranty_management`。
- RISEMAP 当前事实：质保管理页位于销售分类的服务管理分组，标题为 `质保管理`，说明为 `质保卡台账、到期预警、激活与延保，以及质保规则配置`；视图包含 `概览`、`质保卡`、`质保规则`；概览指标包括生效中、待激活、宽限期、已过保、已终止；当前线上账号各项为 0，并显示 30 / 60 / 90 天到期、按来源、按判定粒度、按责任方、最快到期质保卡、高频返修产品等区域。
- Forge 发现的真实可用性问题：本地当前库已有多张由服务工单生成的质保卡，但质保管理概览仍显示 `生效中 0`，并且表格末尾保留全是 `—` 的操作列，造成数据误导和无意义控件占位。
- 本轮修正：质保管理概览指标按当前质保卡状态动态计算，`生效中` 与真实列表一致；未实现的行级动作不再展示为操作列，保留可读台账和返回服务工单入口。
- Forge 浏览器实操：刷新 `page_warranty_management` 后，页面显示 `生效中 20`，表格列为质保卡号、客户、产品/SN、判定粒度、开始日期、到期日期、状态、责任方，不再出现全空操作列。
- 当前结论：质保管理已从静态概览改为真实台账读数；延保、终止、激活等动作仍未做同材料页面办理，不展示为可点击操作。
- 证据：`docs/references/risemap-capture/live/20260914-service-warranty-usability/risemap-warranty-current.ax.txt`、`docs/references/risemap-capture/live/20260914-service-warranty-usability/risemap-warranty-current.png`、`docs/references/risemap-capture/live/20260914-service-warranty-usability/forge-warranty-live-counts.ax.txt`、`docs/references/risemap-capture/live/20260914-service-warranty-usability/forge-warranty-live-counts.png`。

## 2026-09-14 服务分析与服务配置控件可用性补验

本轮重新打开 RISEMAP 当前页面并按控件布局与真实可用性复查服务管理剩余入口。

- RISEMAP `https://risemap.cn/after-sales/stats`：服务分析页为经营看板，顶部有时间范围、地区、团队、计费、类型、紧急度筛选，支持售后主管、工程师、财务视角切换，并可按服务人员、客户、工单类型、时间和区域分析；当前同材料数据为工单总量 1、完成 0、在办 1、SLA 达标率 100%。
- RISEMAP `https://risemap.cn/after-sales/config`：服务配置页包含工单类型、状态与紧急度、质保规则、SLA 规则、费用类型、付款模板、服务人员、报价设置和客户门户；当前工单类型下有一条 `RISEMAP 对照服务类型 20260913`，并有新增、编辑、停用、删除入口。
- Forge 发现的真实可用性问题：`page_service_analysis` 原先用服务工单明细对象硬套分析列，收入、完成数、满意度等列没有可靠来源，末尾还有不可办的操作列；`page_service_config` 原先显示没有完整办理流程支撑的新增入口和空操作列，分类也只是静态说明。
- Forge 修正结论：服务分析改为真实汇总页，按当前服务工单、服务报价、服务结算和质保卡统计工单总量、服务收入、报价金额、质保卡，并支持按服务类型、客户、工程师三种维度切换；表格只保留可解释的分析字段，不再显示操作列。服务配置改为可切换分类核对页，当前未实现配置维护动作时不显示新增、编辑、停用或删除按钮，空态改为对应分类的业务说明。
- 本轮证据目录：`docs/references/risemap-capture/live/20260914-service-analysis-config-usability/`。

当前边界：RISEMAP 配置维护动作已观察到入口，但 Forge 暂未实现同等新增、编辑、停用和删除流程；因此服务配置本轮只验收为“当前生效配置核对页”，不写成配置维护闭环。

## 2026-09-20 服务管理全组控件几何回归

- Forge 实际打开服务工单、服务报价单、服务结算单、接单中心、派工中心、服务分析、质保管理、服务配置共 8 页，分别在 `1280 × 900` 与 `760 × 900` 检查，共 16 个页面视口组合。
- 可见按钮、输入框、选择器和文本域之间未发现相交，页面根容器无横向溢出。服务配置在 `760 × 900` 下发现第九个分类页签“客户门户”被容器右边界截断。
- 服务配置窄屏页签已改为三列网格（`520px` 以下两列），复验页签容器高度 `133px`，九个页签均无截断、重叠或越界；桌面仍保持单行页签。
- 本轮只新增响应式布局修正，没有改写服务业务状态或数据。其余服务页的同材料办理、持久化和历史页面证据沿用既有记录；全组仍不得仅凭本轮几何通过改为复刻验收完成。

严格复扫又发现服务报价、服务结算和接单中心在 `760 × 900` 下，Console 的“在 Studio 中编辑”悬浮入口与页面刷新按钮相交 `32px²`；这些通用页面还直接请求 `/api/v1`，没有复用 ObjectStack adapter，页面会显示 `UNAUTHENTICATED`。现已将六个通用 CRM/服务页面统一接入共享 adapter 请求，并在窄屏为 Console 悬浮入口预留空间。修正后 28 个销售、CRM、服务入口在桌面和窄屏两种视口下复扫，页面根横向溢出、控件相交、按钮文字裁切、非表格控件越界和过小点击目标均为 `0`。证据见 `docs/evidence/sales-controls-20260920/geometry-audit.json`；这不替代服务页逐项同材料办理、弹窗全过程和持久化验收。
