# 销售 / CRM客户管理

当前发现 8 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-057 | 客户管理 | `https://risemap.cn/base/customers` | 客户管理 | 新增客户、导入/导出、批量操作、扫描名片、刷新、分类、主负责人、协同销售、客户类型、标签、状态、级别、上一页、1、下一页 | [截图](../../../references/risemap-capture/250-rm-057-loaded.png) | 首屏已采集，流程未验证 |
| RM-058 | 联系人管理 | `https://risemap.cn/base/contacts` | 联系人管理 | 新增联系人、导入/导出、全部维护人、刷新联系人数据、切换为紧凑行高 | [截图](../../../references/risemap-capture/252-rm-058-loaded.png) | 首屏已采集，流程未验证 |
| RM-059 | 销售报价 | `https://risemap.cn/sales/quotations` | 销售报价 | 新建报价、导入/导出、刷新、范围、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/254-rm-059-loaded.png) | 首屏已采集，流程未验证 |
| RM-060 | 客户物料对照 | `https://risemap.cn/base/customer-materials` | 客户物料对照 | 新增对照、导入/导出、刷新、按客户筛选 | [截图](../../../references/risemap-capture/256-rm-060-loaded.png) | 首屏已采集，流程未验证 |
| RM-061 | 商机管理 | `https://risemap.cn/sales/opportunities` | 商机管理 | 新建商机、导入/导出、刷新、范围、阶段、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/258-rm-061-loaded.png) | 首屏已采集，流程未验证 |
| RM-062 | 线索管理 | `https://risemap.cn/sales/leads` | 线索管理 | 我的线索、我的团队、全部线索、线索公海、全部状态、全部来源、新建线索、导入/导出 | [截图](../../../references/risemap-capture/260-rm-062-loaded.png) | 首屏已采集，流程未验证 |
| RM-063 | 跟进记录 | `https://risemap.cn/sales/follow-ups` | 跟进记录 | 范围、客户负责人、跟进状态、高级筛选、导出、新增跟进、全部、电话沟通、微信沟通、邮件往来、上门拜访、客户来访、线上会议、产品演示、方案讲解、商务谈判、其他、最新优先、+ 添加第一条跟进 | [截图](../../../references/risemap-capture/262-rm-063-loaded.png) | 首屏已采集，流程未验证 |
| RM-064 | 公海客户 | `https://risemap.cn/sales/public-sea` | 公海客户 | 新建公海客户、批量操作、导入、导出、导入/导出任务、刷新、行业、来源、级别、上一页、1、下一页 | [截图](../../../references/risemap-capture/264-rm-064-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| DR-0243 | RM-057 | 全部客户 | 打开客户管理 | 空列表；字段覆盖负责人、联系人电话、协同销售、信用额度、账期、红绿灯、跟进与交易时间 | 客户主数据同时承载归属、授信和经营活跃度 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/699-rm-057-customer-all.png) |
| DR-0244 | RM-057 | 我负责的 | 切换我负责的客户 | 当前无本人主负责客户 | 主负责人是销售责任和目标归集依据 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/700-rm-057-customer-owned.png) |
| DR-0245 | RM-057 | 我参与的 | 切换我参与的客户 | 当前无本人参与客户 | 协同销售可参与客户经营而不取代主负责人 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/701-rm-057-customer-involved.png) |
| DR-0246 | RM-057 | 下属负责的 | 切换下属负责客户 | 当前无下属主负责客户 | 管理者可查看下属责任客户 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/702-rm-057-customer-sub-owned.png) |
| DR-0247 | RM-057 | 下属参与的 | 切换下属参与客户 | 当前无下属参与客户 | 管理视图覆盖下属协同参与范围 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/703-rm-057-customer-sub-involved.png) |
| DR-0248 | RM-057 | 导入导出菜单 | 展开客户导入导出 | 支持客户、联系人、收货地址、跟进记录导入；当前页、全部筛选、自定义导出和批量任务 | CRM 批量迁移覆盖客户关系与历史活动，不仅客户名称 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/704-rm-057-customer-import-export.png) |
| DR-0249 | RM-057 | 批量操作 | 展开客户批量操作 | 支持批量启用、禁用、修改、释放和删除 | 客户生命周期与归属可批量治理，删除仍需显式选择记录 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/705-rm-057-customer-batch.png) |
| DR-0250 | RM-057 | 名片扫描看板 | 进入名片扫描创建客户 | 年度配额 10 次，已用 0；统计客户、联系人、成交转化、六个月趋势和任务队列 | 名片 OCR 是客户录入入口并受独立识别配额约束 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/706-rm-057-business-card-dashboard.png) |
| DR-0251 | RM-057 | 名片任务表单 | 新建识别任务 | 可命名任务并上传或拖拽或 Ctrl+V 粘贴 JPG/PNG，单次最多 50 张；0 张时创建按钮禁用 | 批量 OCR 先形成可追踪任务，再创建客户与联系人 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/707-rm-057-business-card-task.png) |
| DR-0252 | RM-057 | 企业客户表单 | 打开新增客户 | 企业表单覆盖工商信息、多人联系人及多联系方式、分类级别行业、负责人协同销售、开票、付款与收入确认、地址 | 客户主数据把 CRM、授信、订单、开票和收入确认需要的字段统一维护 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/708-rm-057-customer-form-enterprise.png) |
| DR-0253 | RM-057 | 个人客户表单 | 切换个人客户 | 去除企业工商字段，保留联系人、客户资料、协同销售、开票、商务条件和地址 | 自然人客户沿用同一交易与开票模型但无需企业登记信息 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/709-rm-057-customer-form-personal.png) |
| DR-0254 | RM-057 | 空提交校验 | 个人客户空表单直接创建 | 仅客户名称和客户分类提示必填；负责人默认当前用户，联系人、开票和商务条件可后补 | 最小客户档案需要名称、分类和负责人归属 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/710-rm-057-customer-validation.png) |
| DR-0255 | RM-057 | 快捷客户分类 | 从客户表单新增客户分类 | 分类只需名称并可选 12 种标识颜色；名称为空时添加禁用 | 分类字典可在录入时补齐并用于检索分群 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/711-rm-057-customer-category-quick.png) |
| DR-0256 | RM-057 | 快捷客户等级 | 从客户表单新增客户等级 | 等级只需名称并可选 12 种标识颜色；名称为空时添加禁用 | 等级字典可在录入时补齐并支撑客户分层 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/712-rm-057-customer-level-quick.png) |
| DR-0257 | RM-057 | 多联系人 | 新增第二位联系人 | 每位联系人可单独设主要联系人、删除并维护姓名、职位、性别、部门、决策权重、备注与多种联系方式 | 一个客户支持完整决策链，主联系人可随时切换 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/713-rm-057-customer-multi-contact.png) |
| DR-0258 | RM-057 | 联系方式类型 | 展开新增联系方式 | 支持手机、座机、邮箱、微信、钉钉、QQ、LinkedIn 和其他，同类型可多条并自定义标签 | 联系人触达渠道结构化且可扩展，不限单个电话 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/714-rm-057-contact-channel-types.png) |
| DR-0259 | RM-057 | 决策权重 | 展开联系人决策权重 | 可按价格、交期、质量、服务、品牌和付款条件标记联系人关注重点，并支持搜索 | 客户决策链可记录不同联系人的购买关注因素 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/715-rm-057-contact-decision-weight.png) |
| DR-0260 | RM-057 | 商务默认值 | 检查发票类型、付款条件和收入确认 | 发票类型含一般纳税人与小规模纳税人；付款条件当前无预设；收入确认支持出库、开票、里程碑、周期和手动 | 客户档案可为后续订单预置税务、账期和收入确认口径 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/716-rm-057-customer-commercial-defaults.png) |
| DR-0261 | RM-057 | 分类筛选 | 展开客户分类筛选 | 当前仅全部，未配置客户分类 | 分类筛选直接依赖客户分类字典 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/717-rm-057-customer-filter-category.png) |
| DR-0262 | RM-057 | 主负责人筛选 | 展开主负责人筛选 | 可选全部或金一涛 | 负责人筛选来自系统员工并用于责任客户检索 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/718-rm-057-customer-filter-owner.png) |
| DR-0263 | RM-057 | 协同销售筛选 | 展开协同销售筛选 | 可选全部或金一涛 | 协同参与客户可按成员独立检索 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/719-rm-057-customer-filter-collaborator.png) |
| DR-0264 | RM-057 | 客户类型筛选 | 展开客户类型筛选 | 支持全部、公司、个人 | 主体类型可独立过滤企业与自然人客户 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/720-rm-057-customer-filter-type.png) |
| DR-0265 | RM-057 | 标签筛选 | 展开客户标签筛选 | 当前仅全部，未配置客户标签 | 客户标签筛选依赖标签字典 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/721-rm-057-customer-filter-tags.png) |
| DR-0266 | RM-057 | 状态筛选 | 展开客户状态筛选 | 支持全部、启用、禁用 | 停用客户可保留档案但从有效业务对象中隔离 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/722-rm-057-customer-filter-status.png) |
| DR-0267 | RM-057 | 级别筛选 | 展开客户级别筛选 | 当前仅全部，未配置客户等级 | 客户分层筛选依赖客户等级字典 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-057/723-rm-057-customer-filter-level.png) |
| DR-0268 | RM-058 | 全部联系人 | 打开联系人管理 | 统计联系人总数、在职、不在原公司和关键决策人；当前均为 0 | 联系人独立于客户表单维护并记录职业状态 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/724-rm-058-contacts-all.png) |
| DR-0269 | RM-058 | 在职 | 切换在职联系人 | 当前在职联系人 0 | 在职状态用于有效触达 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/725-rm-058-contacts-active.png) |
| DR-0270 | RM-058 | 已跳槽 | 切换已跳槽联系人 | 当前已跳槽联系人 0 | 联系人跳槽后可保留个人关系历史并更新任职公司 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/726-rm-058-contacts-moved.png) |
| DR-0271 | RM-058 | 已离职 | 切换已离职联系人 | 当前已离职联系人 0 | 离职联系人保留历史但从有效任职中分离 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/727-rm-058-contacts-left.png) |
| DR-0272 | RM-058 | 已退休 | 切换已退休联系人 | 当前已退休联系人 0 | 退休是独立任职终态 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/728-rm-058-contacts-retired.png) |
| DR-0273 | RM-058 | 停用 | 切换停用联系人 | 当前停用联系人 0 | 停用用于软隔离无效或不再维护的联系人 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/729-rm-058-contacts-disabled.png) |
| DR-0274 | RM-058 | 导入导出 | 展开联系人导入导出 | 支持批量导入、当前页导出、全部筛选结果、自定义导出和批量任务 | 联系人历史可批量迁入并按当前筛选导出 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/730-rm-058-contacts-import-export.png) |
| DR-0275 | RM-058 | 联系人表单 | 打开新增联系人 | 必填姓名和所属客户；记录部门职位、决策权重、维护人、任职状态、主要联系人、多种联系方式与主要方式 | 联系人是独立关系档案，可跨任职变化持续维护 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/731-rm-058-contact-form.png) |
| DR-0276 | RM-058 | 任职状态 | 展开新增联系人任职状态 | 支持在职、已跳槽、已离职、已退休和停用 | 任职变化作为联系人属性持续演进，保留关系历史 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/732-rm-058-contact-employment-status.png) |
| DR-0277 | RM-058 | 决策权重 | 展开独立联系人决策权重 | 价格、交期、质量、服务、品牌、付款条件六类可搜索选择 | 联系人关注重点在客户内联和独立维护入口一致 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/733-rm-058-contact-decision-weight-form.png) |
| DR-0278 | RM-058 | 空提交校验 | 空表单保存联系人 | 保存未执行，姓名与所属客户仍为空且资料保持未保存 | 联系人不能脱离客户或缺少姓名创建 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-058/734-rm-058-contact-validation.png) |
| DR-0279 | RM-059 | 报价列表 | 打开销售报价 | 列表追踪客户、商机、开单人、负责人、物料数、金额、折扣、状态、有效期 | 报价连接商机与销售订单并具备审批状态 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/735-rm-059-quotation-list.png) |
| DR-0280 | RM-059 | 报价分析 | 切换报价分析 | 按 6 个月统计报价单数、总额、成交、成交率、平均单价、公司月度趋势、人员或团队趋势、分布和明细 | 报价效果从公司到人员或团队形成可追溯漏斗 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/736-rm-059-quotation-analytics.png) |
| DR-0281 | RM-059 | 近3月 | 切换近 3 月 | 分析窗口改为 3 个月 | 报价分析支持短周期滚动观察 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/737-rm-059-quotation-range-3m.png) |
| DR-0282 | RM-059 | 近12月 | 切换近 12 月 | 分析窗口改为 12 个月 | 报价分析支持完整年度趋势 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/738-rm-059-quotation-range-12m.png) |
| DR-0283 | RM-059 | 自定义范围 | 切换自定义时间 | 出现起止月份输入，默认延续过去 12 个月 | 分析支持任意月份区间 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/739-rm-059-quotation-range-custom.png) |
| DR-0284 | RM-059 | 团队分析 | 将趋势、成交对比和明细切换为团队 | 视图改为团队报价趋势、团队成交对比和团队明细，明细含人数与人均单数 | 同一报价数据可按销售成员或组织汇总 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/740-rm-059-quotation-analytics-team.png) |
| DR-0285 | RM-059 | 负责人范围 | 展开报价范围筛选 | 支持所有、我负责的、下属负责的、我关注的 | 报价视图同时覆盖责任链和主动关注 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/741-rm-059-quotation-scope.png) |
| DR-0286 | RM-059 | 报价状态 | 展开报价状态筛选 | 支持全部、草稿、待审批、已审批、已驳回、已发送、已接受 | 报价从编辑到审批、客户发送和接受形成状态闭环 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/742-rm-059-quotation-status.png) |
| DR-0287 | RM-059 | 导入导出 | 展开报价导入导出 | 支持批量导入、当前页导出、自定义导出和批量任务 | 报价可批量迁移并可控导出 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/743-rm-059-quotation-import-export.png) |
| DR-0288 | RM-059 | 新建报价表单 | 打开新建报价 | 表单含客户与商机、报价类型与主体、有效期、商务条款、物料分组组合、服务费、报价条款、汇总预警和附件；销售视角隐藏成本 | 报价把客户需求、定价审批和可转订单数据一次建模 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/744-rm-059-quotation-form.png) |
| DR-0289 | RM-059 | 管理员视角 | 切换报价角色视角 | 管理员可查看总成本、毛利和毛利率；销售视角隐藏这些字段 | 角色权限保护成本与利润，同时允许管理者审核定价 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/745-rm-059-quotation-admin-view.png) |
| DR-0290 | RM-059 | 价格预警 | 展开价格预警设置 | 阈值可用滑块或输入框，快捷选任何偏差、3%、5%、10%；对比历史成交与报价 | 异常定价可按偏差门槛触发审批关注 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/746-rm-059-quotation-price-alert.png) |
| DR-0291 | RM-059 | 快捷报价类型 | 新增报价类型 | 类型需名称并可选 12 种标识颜色 | 报价分类字典可在开单时维护 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/747-rm-059-quotation-type-quick.png) |
| DR-0292 | RM-059 | 报价类型校验 | 空名称添加报价类型 | 类型名称提示不能为空并阻止添加 | 报价类型字典不能产生空项 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/748-rm-059-quotation-type-validation.png) |
| DR-0293 | RM-059 | 快捷报价主体 | 新增公司抬头 | 字段含公司全称、统一社会信用代码、简称、地址、电话和邮箱 | 报价主体字典承载对外法律主体与联络信息 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/749-rm-059-quotation-issuer-quick.png) |
| DR-0294 | RM-059 | 报价主体校验 | 空公司抬头添加 | 公司全称和统一社会信用代码提示不能为空 | 报价法律主体必须可唯一识别 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/750-rm-059-quotation-issuer-validation.png) |
| DR-0295 | RM-059 | 付款方式 | 展开报价付款方式 | 支持银行转账、支付宝、微信支付、现金、支票、其他、电汇、承兑汇票、在线支付、信用证 | 报价明确客户结算渠道并可继承到订单 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/751-rm-059-quotation-payment-methods.png) |
| DR-0296 | RM-059 | 物料选择 | 打开添加物料 | 两步选择器第 1 步按分类、图片、物料属性和来源类型筛选；无物料时下一步禁用 | 报价只能从受控物料库选择后进入数量定价步骤 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/752-rm-059-quotation-material-picker.png) |
| DR-0297 | RM-059 | 物料分组 | 新建报价分组 | 分组名称必填，说明可选且会显示在导出件；空名称时创建禁用 | 复杂设备报价可按系统或子项组织输出 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/753-rm-059-quotation-group.png) |
| DR-0298 | RM-059 | 临时物料 | 打开批量新增临时物料 | 默认 3 行，名称和型号必填；可填规格、分类、单位、数量、预估单价、备注，并快捷新增分类和单位；后续可转正式物料 | 报价可响应物料库外需求，同时保留后续主数据归一入口 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/754-rm-059-quotation-temporary-material.png) |
| DR-0299 | RM-059 | 物料批量导入 | 打开批量导入报价物料 | 四步为上传文件、字段识别、校验修正、导入结果；支持 xlsx/xls、标准模板和示例数据，并声明不会静默修改数量价格税率或匹配结果 | 批量报价物料经过显式映射和逐行校验 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/755-rm-059-quotation-material-import.png) |
| DR-0300 | RM-059 | 示例数据校验 | 载入示例数据 | 16 行全部阻断；检测物料不存在、分类未匹配、必填缺失、数量非正、价格负数、非法税率；支持逐行修正重匹配、跳过、批量跳过和导出异常，0 可导入时提交禁用 | 批量导入拒绝静默纠错，异常必须显式处置 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/756-rm-059-quotation-material-import-validation.png) |
| DR-0301 | RM-059 | 供应商价本 | 打开供应商价本 | 先选择供应商，再展示有效价本和报价物料，选择后自动加入明细 | 销售报价可引用采购侧供应商价本进行成本核算 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/757-rm-059-quotation-supplier-pricebook.png) |
| DR-0302 | RM-059 | 空白明细行 | 添加空行 | 空白行包含物料、型号、规格、单位、数量、含税单价、税率、折扣、折后含税小计、行备注、复制和删除；数量默认 1、税率默认 13%，未选物料时不可勾选且唯一行不可删除 | 报价明细以物料为必选核心，默认值减少录入但仍阻止无物料行进入批量操作 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/758-rm-059-quotation-blank-line.png) |
| DR-0303 | RM-059 | 全部字段 | 切换全部字段 | 全部字段模式将空白行展开为编码、物料/服务名称、型号、规格、分类、单位、数量、含税价、不含税价、税率、折扣、小计及行备注；名称、型号、规格、分类、单位、数量、价格、税率标为必填 | 报价单支持完整物料主数据的行级录入并同时维护含税和未税价格 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/759-rm-059-quotation-all-fields.png) |
| DR-0304 | RM-059 | 服务费固定金额 | 打开添加服务项目 | 服务费要求名称；计费支持固定金额、单价×数量、按比例；固定金额模式含金额、折扣快捷值 0/5/10/15/20%、税率快捷值免税/1/3/6/9/13%、含税合计和备注，未填时确认禁用 | 非物料费用可独立计价、折扣、计税并汇入报价总额 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/760-rm-059-quotation-service-fixed.png) |
| DR-0305 | RM-059 | 服务费单价数量 | 切换单价×数量 | 数量模式录入不含税单价和数量，数量默认 1，并继续应用折扣、税率与备注 | 安装、运输等可按工作量计费并自动换算税价 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/761-rm-059-quotation-service-quantity.png) |
| DR-0306 | RM-059 | 服务费按比例 | 切换按比例 | 比例模式可选物料折前总价、折后总价或自定义金额为基数；费率默认 8%，快捷值 3/5/8/10/12/15/20%，再叠加服务费折扣和税率 | 项目管理费等可按报价基数自动计算且保留税费口径 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/762-rm-059-quotation-service-percentage.png) |
| DR-0307 | RM-059 | 报价预设条款 | 选择预设 | 预设条款抽屉当前为空，只有已维护的预设才能加入报价 | 报价条款可复用标准商务约定，空配置时明确提示 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/763-rm-059-quotation-terms-preset.png) |
| DR-0308 | RM-059 | 自定义报价条款 | 新增自定义条款 | 自定义条款在报价内展开标题与正文输入，内容为空时添加按钮禁用 | 单张报价可补充个性化商务约定且空条款不能加入 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/764-rm-059-quotation-terms-custom.png) |
| DR-0309 | RM-059 | 报价预览校验 | 预览空报价 | 预览会执行提交级校验：客户、报价类型、报价主体不能为空，且至少需一项有效物料/服务明细；失败项就地标红并提示检查必填项 | 报价单输出前复用完整性校验，避免生成缺关键业务信息的文档 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/765-rm-059-quotation-preview-validation.png) |
| DR-0310 | RM-059 | 草稿校验 | 空表单保存草稿 | 草稿保存同样要求客户、报价类型、报价主体和至少一项有效明细，不允许保存结构不完整的空壳报价 | 草稿仍具备最小业务完整性，避免后续审批链出现不可识别记录 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/766-rm-059-quotation-draft-validation.png) |
| DR-0311 | RM-059 | 提交审核校验 | 空表单提交审核 | 提交审核复用同一组必填校验并阻断，页面保留当前输入状态供修正 | 审批入口只接受关键主体与明细完整的报价 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/767-rm-059-quotation-submit-validation.png) |
| DR-1637 | RM-059 | 第二遍有效保存 | 用 `OEM-RM-20260909-A` 客户与成品创建含税报价并重新打开详情 | 保存 `QT-OEM-20260909-001` 草稿；控制柜 2 台、含税单价 128000、税率 13%、折扣 5%，原含税额 256000、优惠 12800、折后含税 243200、折后未税 215221.24、税额 27978.76；有效期至 2026-10-09，详情保留客户、联系人、主体、类型、负责人、付款方式和说明 | 首次证明标准数据报价可真实持久保存，并为 Forge 同输入金额与关联对照提供基线；未提交审核 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-059/768-rm-059-observed-saved-quotation.jpg) |
| DR-0312 | RM-060 | 对照列表 | 进入客户物料对照 | 概览统计对照条数、涉及客户、涉及物料；支持模糊搜索、按客户筛选，表格并列我方编码名称与客户编码名称、备注和最近维护时间 | 报价与订单可在企业内部物料和客户侧料号之间建立可追溯映射 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-060/768-rm-060-customer-material-list.png) |
| DR-0313 | RM-060 | 对照导入导出 | 展开导入导出 | 菜单提供批量导入、导出当前页、导出全部筛选结果和批量任务 | 客户料号映射支持批量迁移、按范围导出和异步任务追踪 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-060/769-rm-060-customer-material-transfer.png) |
| DR-0314 | RM-060 | 对照批量导入 | 打开批量导入 | 三步为上传文件、数据预览、任务提交；模板必填客户名称、我方物料编码与名称、客户物料编码；客户名称自动匹配，失败记录跳过，相同客户+我方编码+客户编码的重复项自动更新 | 批量映射采用幂等更新键并在预览后异步提交，但客户匹配失败会被跳过 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-060/770-rm-060-customer-material-import.png) |
| DR-0315 | RM-060 | 新增对照表单 | 打开新增对照 | 表单必选客户和我方物料；客户物料编码与名称至少填一项，并可填写备注 | 单条映射以客户和内部物料为主键语境，允许客户只提供料号或名称 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-060/771-rm-060-customer-material-form.png) |
| DR-0316 | RM-060 | 新增对照校验 | 空表单确认新增 | 空表单提交保持弹窗开启且不产生记录；客户、我方物料和客户侧编码/名称约束仍未满足 | 系统阻止创建无法解析双方物料身份的空映射 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-060/772-rm-060-customer-material-validation.png) |
| DR-0317 | RM-061 | 商机列表 | 进入商机管理 | 支持列表/看板、范围/阶段/来源筛选和搜索；列表包含客户联系人及职务电话邮箱、阶段、来源、描述、竞争对手、红绿灯、优先级、金额、成功率、预计成交日和负责人 | 商机视图同时承载关系人、销售判断、竞争态势和预测金额日期 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/773-rm-061-opportunity-list.png) |
| DR-0318 | RM-061 | 商机看板 | 切换看板 | 看板按初步接触、需求确认、方案报价、商务谈判、合同签订五列展示，每列统计商机数和金额 | 商机管道按阶段聚合数量与预测金额，便于推进和容量判断 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/774-rm-061-opportunity-kanban.png) |
| DR-0319 | RM-061 | 商机表单 | 打开新建商机 | 表单分基本信息、客户与联系人、竞争信息；必填商机名称、阶段、负责人和客户，另含预计金额/日期、优先级、来源、描述、联系人职务邮箱、竞争对手及只读创建更新时间 | 商机把预测、责任、客户关系和竞争情报合并为单一销售对象 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/775-rm-061-opportunity-form.png) |
| DR-0320 | RM-061 | 商机阶段 | 展开阶段选择 | 阶段选项为初步接触、需求确认、方案报价、商务谈判、合同签订、赢单、输单；看板仅展示推进中的前五列 | 商机漏斗将进行中阶段和最终赢输结果分开表达 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/776-rm-061-opportunity-stages.png) |
| DR-0321 | RM-061 | 优先级与来源 | 展开优先级和来源 | 优先级为高/中/低，默认中；来源为线索转化、老客户复购、老客户推荐、招投标、主动询盘、合作伙伴推荐、行业活动 | 商机可按紧急程度和获客渠道细分，支持后续渠道质量分析 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/777-rm-061-opportunity-options.png) |
| DR-0322 | RM-061 | 商机必填校验 | 空表单创建 | 必填校验明确阻断缺商机名称、阶段和客户；负责人默认当前人已满足，失败字段就地标红并提示检查 | 商机必须具备可识别主题、管道阶段、客户和责任人才能进入销售预测 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/778-rm-061-opportunity-validation.png) |
| DR-0323 | RM-061 | 商机导入导出 | 展开导入导出 | 提供批量导入、导出当前页、导出全部筛选结果、自定义导出和批量任务 | 商机数据可按当前范围、全部筛选结果或自选字段交换并追踪异步任务 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/779-rm-061-opportunity-transfer.png) |
| DR-0324 | RM-061 | 商机批量导入 | 打开批量导入 | 三步导入接受 xlsx/xls；预览时逐列指定目标字段并设置数据起始行，随后系统校验写入，另提供模板下载 | 商机导入允许适配不同 Excel 列布局并显式控制表头起始行 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-061/780-rm-061-opportunity-import.png) |
| DR-0325 | RM-062 | 线索列表 | 进入线索管理 | 概览统计全部、新线索、已转化、公海线索；责任范围为我的线索、我的团队、全部线索、线索公海，并支持状态、来源、搜索和新建/导入导出 | 线索以责任范围和公海机制管理获客入口，并追踪转化结果 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/781-rm-062-lead-list.png) |
| DR-0326 | RM-062 | 线索状态 | 展开状态筛选 | 状态包括待跟进、新线索、已分配、已联系、跟进中、有意向、有效线索、已转商机、已无效、暂缓跟进、暂搁置 | 线索从获客、分配、联系、资格判断到转化或退出均有显式状态 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/782-rm-062-lead-statuses.png) |
| DR-0327 | RM-062 | 线索来源 | 展开来源筛选 | 来源包括官网注册、官网咨询、广告投放、SEO/SEM、展会获取、行业活动、客户转介绍、电话开发、陌拜开发、社交媒体、合作伙伴、媒体报道、其他 | 线索来源覆盖线上营销、活动、推荐、外呼陌拜和生态渠道，可比较获客效果 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/783-rm-062-lead-sources.png) |
| DR-0328 | RM-062 | 线索表单 | 打开新建线索 | 必填公司名称与来源；另含联系人、职位、手机号、邮箱、行业、地区、预估金额、描述。归属必选，默认自己，也可分配给销售或录入线索公海 | 线索可在创建时决定个人责任、定向分配或公海流转，减少二次分派 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/784-rm-062-lead-form.png) |
| DR-0329 | RM-062 | 线索行业 | 展开行业选择 | 行业预设电子半导体、机械制造、建筑工程、纺织服装、轻工日化、IT/互联网、金融、医疗、教育、汽车、食品、化工、能源、物流、农业及其他 | 线索按标准行业口径分类，便于行业转化和销售能力分析 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/785-rm-062-lead-industries.png) |
| DR-0330 | RM-062 | 线索定向分配 | 选择分配给销售 | 定向分配要求先选销售团队，再从团队成员中选择必填销售人员；未选团队时人员选择禁用 | 线索分配受团队成员范围约束，责任人选择依赖组织归属 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/786-rm-062-lead-assignment.png) |
| DR-0331 | RM-062 | 线索必填校验 | 以定向分配空表单创建 | 公司名称不能为空；选择分配给销售后销售团队也成为必填，人员依赖团队；来源默认官网注册已满足 | 线索的内容必填和组织分配约束同时生效，阻止无公司或无团队责任的线索 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/787-rm-062-lead-validation.png) |
| DR-0332 | RM-062 | 线索导入导出 | 展开导入导出 | 提供批量导入、导出当前页、导出全部筛选结果、自定义导出和批量任务 | 线索支持批量迁移和按范围或字段导出，并统一追踪后台任务 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/788-rm-062-lead-transfer.png) |
| DR-0333 | RM-062 | 线索批量导入 | 打开批量导入 | 三步 xlsx/xls 导入允许预览列映射和设置起始行；负责人留空时默认进入线索公海 | 批量获客数据在缺责任人时不会误归个人，而进入可领取的公共池 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-062/789-rm-062-lead-import.png) |
| DR-0334 | RM-063 | 跟进列表 | 进入跟进记录 | 概览总记录、本周、待跟进、已过期、覆盖客户；按范围、客户负责人、状态和高级条件筛选。类型含电话、微信、邮件、上门、客户来访、线上会议、演示、方案讲解、谈判和其他，支持列表/日历 | 跟进活动覆盖沟通渠道和售前动作，并以时间状态监控承诺 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/790-rm-063-followup-list.png) |
| DR-0335 | RM-063 | 跟进状态 | 展开跟进状态 | 状态筛选为全部、本周跟进、待跟进和已过期 | 跟进状态以时间承诺为核心区分近期完成、未来待办和逾期风险 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/791-rm-063-followup-status.png) |
| DR-0336 | RM-063 | 跟进高级筛选 | 展开高级筛选字段 | 多条件为 AND；可按客户、联系人、关联商机、跟进方式、内容、结果、跟进人、下次跟进日期、创建时间组合筛选，并可增删条件或清空 | 跟进审计可跨对象、人员、内容结果和时间构造精确查询 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/792-rm-063-followup-advanced-filter.png) |
| DR-0337 | RM-063 | 跟进日历 | 切换日历视图 | 月历可切换月份并按人员筛选，以 0、1、2、3-4、5+ 次频次分层，展示本月合计、月度统计和按类型分布 | 跟进日历从单条记录上升为人员触达频次和活动结构视图 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/793-rm-063-followup-calendar.png) |
| DR-0338 | RM-063 | 跟进表单 | 打开新增跟进 | 必填客户、跟进方式、跟进内容；联系人、拜访计划和商机依赖客户；另含跟进结果、下次日期和下次行动 | 跟进记录连接客户、联系人、商机和拜访计划，并把本次结果转成下次行动承诺 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/794-rm-063-followup-form.png) |
| DR-0339 | RM-063 | 跟进必填校验 | 空表单创建 | 客户、跟进方式、跟进内容均提示不能为空并阻断提交；依赖客户的联系人和商机仍禁用 | 每条跟进必须明确对象、渠道和实质内容，才能计入活动和计划统计 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/795-rm-063-followup-validation.png) |
| DR-0340 | RM-063 | 跟进导出 | 展开导出 | 可导出当前列表或进入自定义导出 | 跟进记录既可按当前筛选快速导出，也可自选字段生成审计材料 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-063/796-rm-063-followup-export.png) |
| DR-0341 | RM-064 | 公海客户列表 | 进入公海客户 | 未分配或已释放客户可被销售领取；支持按行业、来源、级别筛选和搜索。列表含客户、行业、级别、联系人、城市、来源、预估价值、释放天数和操作 | 客户公海把失配或释放资源重新分配，并以释放时长监控闲置 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/797-rm-064-public-sea-list.png) |
| DR-0342 | RM-064 | 公海批量操作 | 展开批量操作 | 批量操作包括领取、分配和删除，需先勾选记录 | 公海客户既可由销售自领，也可由管理者定向分配或清理 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/798-rm-064-public-sea-batch.png) |
| DR-0343 | RM-064 | 公海客户表单 | 打开新建公海客户 | 必填客户名称和联系人；另含行业、客户级别、电话、邮箱、城市和逗号分隔标签 | 公海录入要求至少有客户和可联系对象，补充画像后供销售领取 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/799-rm-064-public-sea-form.png) |
| DR-0344 | RM-064 | 公海客户校验 | 空表单创建 | 客户名称和联系人均提示不能为空并阻断提交 | 公海客户不能成为无企业身份或无联系人线索的孤立资源 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/800-rm-064-public-sea-validation.png) |
| DR-0345 | RM-064 | 公海客户导入 | 打开批量导入 | 三步模板导入要求客户名称、客户分类、客户类型；导入客户无负责人、全员可领取；客户名不可重复，重复记录跳过。支持 xlsx/xls，csv 需另存 xlsx | 公海批量入口用去重规则创建无负责人客户，导入字段口径与单条公海表单存在差异需复制时兼容 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/801-rm-064-public-sea-import.png) |
| DR-0346 | RM-064 | 公海客户导出 | 展开导出 | 可导出当前页或自定义导出 | 公海客户支持快速导出当前队列和按需选择字段 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/802-rm-064-public-sea-export.png) |
| DR-0347 | RM-064 | 公海批量任务 | 打开导入导出任务 | 任务表记录任务、来源、状态、进度、结果、失败原因、提交时间与操作，支持刷新和分页 | 公海批量交换具备可追踪状态和逐任务失败证据 | [截图](../../../references/risemap-capture/deep/sales/crm/rm-064/803-rm-064-public-sea-tasks.png) |
