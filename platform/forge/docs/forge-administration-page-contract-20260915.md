# Forge 行政模块页面合同与实时盘点

更新于 2026-09-15。分支 `codex/administration-pages`，独立端口 `4411`，独立数据库 `.objectstack/administration-pages.sqlite`。

## 证据边界

- RISEMAP 当前页面通过已登录的 Codex 内置浏览器逐页打开，覆盖 RM-099 至 RM-130 的 32 个入口。实时页面与 `docs/risemap-page-contracts.md` 已保存首屏合同一致；本轮没有向 RISEMAP 提交或修改业务数据。
- Forge 修改前 32 个入口全部指向 `page_administration_gap`，只能显示入口目录，没有独立页面、业务数据、筛选、表单或办理结果。
- Forge 修改后 32 个入口均拥有独立页面标识和 URL，并按岗位任务选择 `workbench`、`task_workspace`、`timesheet_composite`、`analysis` 或 `configuration` 原型。页面使用 ObjectStack Console 和共享 `product-ui.ts` 控件。
- 当前增加的 `forge_administration_record` 是 Forge 的可运行草稿与页面回读载体，不代表 RISEMAP 已证明这些业务共享最终数据模型。RISEMAP 未完成同材料提交、审批、撤回、归还、折旧、薪酬或流程发布，因此所有页面继续登记为 `review_required`。

## 逐页合同

| 页面 | RISEMAP 当前入口与事实 | Forge 当前表现 | 岗位 / 主单据 | 字段、状态与动作 | 阻断、来源与下一步 | 原型 / 状态 |
|---|---|---|---|---|---|---|
| 我的审批 | `/workflow/approval-center`；待我审批、我已审批、全部及任务表 | 独立只读任务页、搜索、状态筛选、刷新 | 审批人 / 审批任务 | 任务编号、名称、流程、发起人、日期、状态；不开放未验证审批动作 | 来源为流程实例；下一步待同材料审批复核 | task_workspace / review_required |
| 抄送我的 | `/workflow/cc-to-me`；全部、未读、已读及抄送表 | 独立只读抄送页、搜索、状态筛选 | 被抄送人 / 抄送记录 | 编号、流程标题、发起人、时间、进度、状态 | 来源为流程抄送；全部标记已读待复核 | task_workspace / review_required |
| 我发起的 | `/workflow/my-instances`；草稿至暂停八类状态、发起审批 | 独立列表和可保存草稿表单 | 发起人 / 审批实例 | 编号、标题、类型、优先级、日期、状态 | 结束、反审核、取消和暂停规则待复核 | task_workspace / review_required |
| 行政申请 | `/workflow/admin-applications`；考勤假期、行政事务、用车资质入口 | 分类工作台和可保存申请草稿 | 员工 / 行政申请 | 标题、分类、人员、部门、日期、数量、金额、说明 | 来源为申请分类；下一步待流程定义联动 | workbench / review_required |
| 公司通知 | `/ops/notices`；发布通知及类别、范围、状态列表 | 独立通知列表和可保存草稿 | 行政 / 公司通知 | 编号、主题、类别、部门、发布人、日期、状态 | 接收范围和阅读回执待复核 | task_workspace / review_required |
| 用章管理 | `/ops/seals`；申请、待盖章、印章台账、统计 | 四页签任务页和可保存申请 | 申请人、印章管理员 / 用章申请 | 文件、印章类型、申请人、日期、状态 | 盖章执行和印章台账关系待复核 | task_workspace / review_required |
| 会议纪要 | `/ops/meetings`；新建、类型、状态、会议列表 | 独立任务页和可保存纪要 | 会议主持人 / 会议纪要 | 主题、类型、主持人、日期、状态、说明 | 参会人和待办联动待复核 | task_workspace / review_required |
| 工作汇报 | `/ops/reports`；工作汇报、汇报规则、新建汇报 | 汇报与规则组合页和可保存草稿 | 员工、主管 / 工作汇报 | 标题、类型、提交人、周期、日期、状态 | 评分和审批规则待复核 | timesheet_composite / review_required |
| 文档中心 | `/ops/docs`；文件夹、上传、收藏、日期和双视图 | 配置型文档目录；仅开放可保存文件夹草稿 | 文档管理员 / 文档目录 | 名称、分类、负责人、日期、状态 | 文件上传和版本权限待复核 | configuration / review_required |
| 固定资产 | `/ops/assets`；资产台账、导入导出、月度折旧 | 独立资产任务页和可保存资产草稿 | 行政、财务 / 固定资产 | 编号、名称、分类、原值、责任人、部门、日期、状态 | 折旧计算与财务承接待复核 | task_workspace / review_required |
| 资质与申报 | `/ops/certificates`；台账、提醒、政策申报、材料库 | 四页签任务页和可保存资质 | 行政 / 资质记录 | 证书、类别、机构说明、有效期、责任人、状态 | 到期提醒和材料关系待复核 | task_workspace / review_required |
| 物料领取 | `/ops/materials`；申请、物品库、领取记录 | 三页签任务页和可保存申请 | 员工、行政 / 领取申请 | 物品、数量、申请人、日期、状态 | 库存扣减和审批待复核 | task_workspace / review_required |
| 设备维护 | `/ops/equipment-maintenance`；设备、工单、规则、提醒、费用 | 五页签任务页和可保存设备记录 | 设备管理员 / 设备与工单 | 编号、名称、型号分类、负责人、保养日期、原值、状态 | 工单生成和费用联动待复核 | task_workspace / review_required |
| 礼品管理 | `/ops/gift/apply`；申请、清单、库、流水 | 四页签任务页和可保存申请 | 行政 / 礼品申请 | 编号、标题、类别、申请人、金额、日期、状态 | 审批和礼品库存流水待复核 | task_workspace / review_required |
| 借出管理 | `/ops/lending`；草稿、审批、借用中、逾期、归还 | 六页签任务页和可保存借用单 | 经办人 / 借用单 | 物品、方向、对象、借还日期、经办人、状态 | 归还与逾期规则待复核 | task_workspace / review_required |
| 车辆管理 | `/ops/vehicles`；公司用车、私车公用、日历、台账、统计 | 五页签组合页和可保存用车申请 | 申请人、车管 / 用车申请 | 路线、车辆、人员、日期、里程、状态 | 派车和费用规则待复核 | timesheet_composite / review_required |
| 人事工作台 | `/hr/workbench`；人员成本、招聘、薪资、入离职、部门分布 | 人事岗位工作台、动态明细和焦点卡 | HR / 人事动态 | 人员、岗位、部门、负责人、日期、状态 | 指标仅来自当前持久记录；下一步进入档案或招聘 | workbench / review_required |
| 员工档案 | `/hr/employees`；员工字段、筛选、导入导出 | 独立员工页和可保存档案草稿 | HR / 员工档案 | 工号、姓名、岗位、职级、部门、入职与合同日期、状态 | 证件、手机号、系统用户与离职联动待复核 | task_workspace / review_required |
| 招聘管理 | `/hr/recruitment`；岗位说明、招聘岗位、编制和状态 | 三页签任务页和可保存岗位 | HR / 招聘岗位 | 岗位、部门、职级、负责人、日期、状态 | 候选人和录用链待复核 | task_workspace / review_required |
| 入职离职 | `/hr/onboarding`；新增记录、类型、部门、岗位、状态 | 三页签任务页和可保存办理记录 | HR / 入离职记录 | 员工、类型、岗位、部门、经办人、日期、状态 | 交接清单和档案状态联动待复核 | task_workspace / review_required |
| 薪酬福利 | `/hr/compensation`；我的薪酬、管理后台、概览、工资条、福利 | 分析型只读页，金额数据不伪造 | 员工、HR / 薪酬记录 | 项目、员工、期间、金额、状态 | 权限、工资计算和发放待复核 | analysis / review_required |
| 规章制度 | `/hr/policies`；类别、汇编、新增、状态与创建人 | 配置型制度页和可保存草稿 | HR / 制度 | 编号、名称、分类、创建人、日期、状态 | 发布、签收和汇编导出待复核 | configuration / review_required |
| 通讯录 | `/hr/contacts`；部门树、人员视图、展开收起、状态与排序 | 配置型双视图只读页 | 全员 / 通讯录 | 工号、姓名、岗位、部门、联系方式、状态 | 数据应来源员工档案；当前联动待复核 | configuration / review_required |
| 加班申请 | `/hr/overtime`；新增、日期、时段、时长、补偿、状态 | 指标与办理组合页和可保存申请 | 员工、主管 / 加班申请 | 单号、事由、补偿、人员、日期、时长、状态 | 时段、补偿兑现和审批待复核 | timesheet_composite / review_required |
| 请假管理 | `/hr/leave`；假期、审批、调休补假、配置 | 四页签组合页和可保存申请 | 员工、主管、HR / 请假申请 | 单号、假别、日期、时长、事由、状态 | 假期余额和调休结转待复核 | timesheet_composite / review_required |
| 出差申请 | `/hr/business-trip`；目的地、交通、日期、天数、预计费用 | 组合页和可保存申请 | 员工、主管 / 出差申请 | 单号、目的地、交通、日期、费用、状态 | 报销和考勤联动待复核 | timesheet_composite / review_required |
| 考勤管理 | `/hr/attendance`；每日、个人、补签、规则、考勤组 | 五页签组合页和可保存考勤记录 | HR、员工 / 考勤记录 | 姓名、部门、日期、工时、来源、状态 | 打卡来源和异常计算待复核 | timesheet_composite / review_required |
| 考勤统计 | `/hr/stats-dashboard`；趋势、状态、部门排名、在岗情况 | 分析页、指标和明细；空数据不伪造图表 | HR、管理者 / 考勤统计 | 范围、部门、日期、出勤率与状态 | 来源为考勤明细；聚合口径待复核 | analysis / review_required |
| 审批记录 | `/workflow/records`；五类状态、流程类型和发起部门 | 分析型审批历史页 | 审批管理员 / 审批记录 | 编号、标题、类型、部门、发起人、日期、状态 | 应来源审批实例；跨页联动待复核 | analysis / review_required |
| 发起流程 | `/workflow/start`；创建流程、分类筛选和流程列表 | 流程入口工作台和可保存流程草稿 | 发起人 / 流程实例 | 编号、名称、分类、负责人、日期、状态 | 只可从已发布定义发起的阻断待复核 | workbench / review_required |
| 流程定义 | `/workflow/definition`；创建、分类、状态、类型 | 配置型流程定义页和可保存草稿 | 流程管理员 / 流程定义 | 编号、名称、分类、负责人、日期、状态 | 节点设计、发布和版本规则待复核 | configuration / review_required |
| 流程分类 | `/workflow/category`；新增、状态和分类列表 | 配置型分类页和可保存分类 | 流程管理员 / 流程分类 | 编号、名称、上级说明、负责人、日期、状态 | 层级和删除阻断待复核 | configuration / review_required |

## 本轮处理结论

1. **功能尚未实现**：RISEMAP 未用同材料成功验证的审批、撤回、折旧、上传、归还、派车、薪酬、考勤聚合、流程发布等跨状态动作。
2. **Forge 已实现但页面/交互待复核**：32 个独立入口、页面级原型、搜索、状态筛选、页签、共享日期/选择/对话框、草稿保存与 SQLite 回读。
3. **RISEMAP 缺少可办理数据、待复核**：当前多数列表为空；本轮只读取页面，不向线上环境创建行政或人事数据。

在逐页完成同材料正常路径、关键异常、操作后跳转、桌面与窄屏视觉复核之前，`tests/page-polish.manifest.json` 中所有行政页面保持 `review_required`，不得称为页面验收通过。
