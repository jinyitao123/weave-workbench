# 跨组件契约

本目录是桌面、Weave 与 Forge 之间定义的唯一来源。

第一批契约包括：

- `identity`：ObjectStack 用户、组织、设备会话和任务委托。
- `work-request`：桌面递交的目标、材料、范围和期望交付。
- `business-action`：Weave 调用 Forge 业务动作的输入、幂等与权限上下文。
- `task-notification`：Forge 或 Weave 向指定员工创建的待办。
- `delivery-receipt`：业务结果、证据、用量和独立核验结果。
- `execution-control`：重试、超时、额度、取消和未知结果核对。

契约落地前必须补齐调用者、身份、输入、输出、错误、版本、幂等、取消和审计字段。

