# 跨组件契约

本目录是桌面、Weave 与 Forge 之间定义的唯一来源。

当前 `v1/` 的 Schema 是契约草稿，尚不代表三方已实现和验收。身份与执行控制的响应、错误和取消细节需要随对应功能补齐。组件仓引用本仓的契约版本与提交，不另维护一份互相漂移的副本。

第一批契约包括：

- `enterprise-session`：桌面可见的登录身份、身份来源、组织环境和安全存储状态。
- `account-binding`：Forge 登录主体与 Weave 用户、组织之间的稳定绑定。
- `task-delegation`：一次任务获准使用的动作、资源、有效期和撤销状态。
- `identity`：工作请求中的设备会话和 Weave 短期任务委托。
- `work-request`：桌面递交的目标、材料、范围和期望交付。
- `business-action`：Weave 调用 Forge 业务动作的输入、幂等与权限上下文。
- `business-capability-catalog`：开发中心可分配给团队成员的 Forge 业务能力及动作参数说明，不暴露 MCP 工具或凭据；参数来源映射保存在成员配置草稿并随发布版本冻结。
- `task-notification`：Forge 或 Weave 向指定员工创建的待办。
- `approval-context`：Workbench 按当前 Forge 身份读取单个原生审批的受限快照、退回版本与材料；修订材料由 Forge 领域动作校验并经 ObjectStack 原生守卫重提，不开放桌面直接重提。
- `team-run-event`：Weave 将团队运行终态交给 Forge 原生收件箱的系统事件。
- `delivery-receipt`：业务结果、证据、用量和独立核验结果。
- `execution-control`：重试、超时、额度、取消和未知结果核对。
- `development-observation`：开发中心读取团队定义、准确版本和归属运行的只读投影。
- `team-member-config-draft`：开发中心按团队成员保存、刷新后可读回且不影响正式运行的配置草稿，包含 Forge 动作参数到本次固定材料来源的显式映射。

契约落地前必须补齐调用者、身份、输入、输出、错误、版本、幂等、取消和审计字段。

## 原生审批上下文

Workbench 使用当前 Forge 登录会话读取 `GET /api/v1/approvals/requests/{requestId}/workbench-context`。客户端不能提交员工 ID、对象 ID 或文件 ID。Forge 先通过原生 ApprovalService 验证当前员工是该 pending 请求的审批人，或是 returned 请求的原提交人，然后只投影该审批快照中的字段和文件。

材料只支持纯文本，每份最多 2 MiB、每个审批最多 11 份；Forge 必须将下载字节与审批快照中保存的 SHA-256 比较后才返回内容。摘要缺失或不一致时失败关闭，不使用当前记录或通用文件 URL 回退。桌面端只显示契约允许的错误，不回显 Forge 错误正文。该端点只读取退回上下文，不执行业务状态转换。退回后的修订材料应由 Forge 业务动作校验和递交，成功后由业务流程继续原审批；桌面让员工通过 Pi 表达这项业务意图，不暴露底层审批状态操作。

错误状态：`401` 表示登录无效，`404` 表示请求不存在或当前身份不具备读取资格，`409` 表示审批状态已变化，`413` 表示材料超限，`415` 表示材料格式不支持，`422` 表示上下文或冻结材料无法安全校验，`503` 表示读取服务暂不可用。客户端只按状态和稳定错误码映射提示，不展示服务端自由文本。
