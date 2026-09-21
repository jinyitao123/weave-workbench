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
- `business-capability-catalog`：开发中心可分配给团队成员的中文业务能力，不暴露 MCP 工具、参数或凭据。
- `task-notification`：Forge 或 Weave 向指定员工创建的待办。
- `delivery-receipt`：业务结果、证据、用量和独立核验结果。
- `execution-control`：重试、超时、额度、取消和未知结果核对。
- `development-observation`：开发中心读取团队定义、准确版本和归属运行的只读投影。
- `team-member-config-draft`：开发中心按团队成员保存、刷新后可读回且不影响正式运行的配置草稿。

契约落地前必须补齐调用者、身份、输入、输出、错误、版本、幂等、取消和审计字段。
