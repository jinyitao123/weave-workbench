# Forge 采购审批逐页交付合同（2026-09-16）

## 页面职责与原型

- pageId：`page_my_approvals`；RISEMAP：`https://risemap.cn/workflow/approval-center`；Forge：`/_console/apps/forge/page/page_my_approvals`。
- 岗位：采购审批人；核心任务：在统一审批中心核对采购申请来源并同意或驳回；主单据为 `forge_approval_task`，来源为 `forge_purchase_request`，通过后交给采购待办池。
- 主原型：`task_workspace`。参考 `project-task-workspace.page.ts`，因为页面围绕待办、来源、意见、结论和完成回读组织，不使用通用行政记录页。
- 首屏顺序：标题与范围页签 → 状态筛选 → 审批任务列表 → 任务办理弹窗。主动作在待处理行的“审批”；来源单据在列表中直接可达。
- 桌面视口 1440×900；窄屏 390×844。当前页面实现复用 `ForgePageHeader`、标准选择、状态和弹窗组件。

## 实时事实与处理结论

- RISEMAP 当前“我的审批”有“待我审批 / 我已审批”和“全部 / 待处理 / 已超时 / 有催办”，列表包含任务编号、任务名称、流程、发起人、时间、催办、状态和操作。
- Forge 保留统一审批页，不在采购申请列表伪造审批按钮；采购申请提交后创建来源绑定的审批实例和任务。
- Forge 审批弹窗要求意见非空；同意后同步申请状态并生成采购待办，驳回后同步申请但不生成待办；重复办理被阻断。
- `Dev Admin` 与 RISEMAP 的金一涛按同一业务用户对照，不记为功能差异。

| 要求编号 | 当前事实或 Forge 决策 | 实现位置 | 验收步骤与结果 | 状态/缺口 |
| --- | --- | --- | --- | --- |
| APR-001 | 审批在统一中心办理 | `approval-center.page.ts`、`procurement.action.ts` | 采购申请提交后打开我的审批，看到来源链接和待处理任务 | pass |
| APR-002 | 意见不能为空 | 标准审批弹窗 | 空意见提交显示阻断；填写意见后可继续 | pass |
| APR-003 | 同意同步来源并生成一条待办 | `procurement_approval_task_decide` | 页面同意后任务消失，采购申请变已通过，待办池出现来源行 | pass |
| APR-004 | 重复办理不可重复生成 | 同一 Action | API 再次办理返回状态变化阻断，待办仍为一条 | pass |
| APR-005 | 双侧同材料办理 | RISEMAP 当前审批中心 / Forge 验收库 | RISEMAP 当前有借款审批材料，没有与 Forge 采购申请相同材料 | blocked：待同材料复核 |

## 验收边界

- interaction 与 Forge business 正常/异常路径已由内置浏览器和 API 实际办理。
- replication 只证明页面结构和审批中心职责，尚未完成 RISEMAP 同一采购材料办理。
- 独立复核未发生，设计状态保持 `review_required`。

