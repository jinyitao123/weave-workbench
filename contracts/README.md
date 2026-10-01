# 跨组件契约

本目录是桌面、Weave 与 Forge 之间定义的唯一来源。

组件仓引用本仓的契约版本与提交，不另维护一份互相漂移的副本。契约落地前必须补齐调用者、身份、输入、输出、错误、版本、幂等、取消和审计字段。

状态含义：**目标**＝已定方向、尚未实现；**草稿**＝未被任何组件采用；**已实现**＝组件代码中存在对应实现，只代表组件可用，场景是否通过以[项目状态](../docs/项目状态.md)为准；**待修订**＝已实现但须按所注决策调整。状态核对于 2026-10-01（总仓 `90c87fc5`、Weave `5a47d405`、Forge `eb90f556`）。

| 契约 | 内容 | 状态 |
| --- | --- | --- |
| `enterprise-session` | 桌面可见的登录身份、身份来源、组织环境和会话保存方式 | 待修订：稳定 `issuer`（决策 002）；身份来源端点Forge 分支 `codex/task-delegation` 已实现，未合入未部署，Weave、桌面待改 |
| `account-binding` | Forge 登录主体与 Weave 用户、组织之间的稳定绑定 | 待修订：稳定 `issuer`（决策 002）；Weave 待改 |
| `task-delegation` | 一次任务获准使用的动作、资源、有效期和撤销状态 | 待修订：当前 Weave 保存员工桌面会话、固定 30 分钟、无撤销；改为 Forge 签发（决策 002） |
| `task-delegation-request` | Host 向 Forge 申请任务委托的请求与回执 | Forge 分支 `codex/task-delegation` 已实现，未合入未部署；Weave、桌面待接入 |
| `work-request` | 桌面递交的目标、材料、范围和期望交付，含 `identity` 定义 | 已实现（映射到 Weave 固定输入登记与派发） |
| `agent-team-handoff` | Host 保存在本地私有目录的固定交接包 | 已实现 |
| `business-capability-catalog` | 开发中心可分配给成员的 Forge 业务能力及参数说明 | 已实现 |
| `business-action` | Weave 调用 Forge 业务动作的输入与权限上下文 | 草稿：未采用，实际走 Forge 原生 MCP `run_action` |
| `delivery-receipt` | 业务结果、证据、用量和独立核验结果 | 草稿：未采用 |
| `task-notification` | 员工工作事项的桌面展示投影 | 草稿：由“员工工作投影”取代方向，待收敛 |
| `work-continuation` | 从 Weave 团队运行消息按确切运行继续原工作 | 已实现 |
| `work-run-lookup` | 批量读取本人运行的当前性与业务结果 | 目标（决策 002） |
| `owned-text-material` | 原文件所有人读取本人未绑定文本原件 | 已实现 |
| `owned-original-material` | PDF/DOCX 原件元数据引用 | 已实现 |
| `approval-context` | 按当前身份读取单个原生审批的受限快照与材料 | 已实现 |
| `approval-work-list` | 本人可办理与被退回审批的只读分页投影 | Forge 分支 `codex/task-delegation` 已实现，未合入未部署；桌面待接入 |
| `approval-revision` | 退回事项的新材料递交与回执核对 | 已实现；R2 递交未在桌面验收 |
| `team-run-event` | Weave 运行事件进入 Forge 原生收件箱 | 待修订（决策 002）：内容摘要冲突、接收人校验、`human_review` 接收与来源投影在 Forge 分支 `codex/task-delegation` 已实现，未合入未部署；Weave 待发 `human_review` |
| `team-run-result` | 团队检查结果的可选结构 | 已实现 |
| `team-run-notification-source` | 按当前身份读取 Weave 团队消息的来源引用 | 已实现 |
| `business-notification-source` | 按当前身份读取 Forge 业务消息的来源与材料 | 已实现 |
| `development-observation` | 开发中心读取团队、版本和运行的只读投影 | 已实现 |
| `team-member-config-draft` | 按成员保存的配置草稿 | 已实现 |
| `team-create`、`team-management`、`workflow-management` | 团队新建、资料与成员、流程草稿与发布 | 已实现 |
| [团队工作区契约](v1/团队工作区契约.md) | 团队开发草稿、试跑与发布 | 待修订：`audience` 团队可用范围（决策 002） |

重试、超时、额度、取消和未知结果核对没有独立 schema，规则写在 [v1 说明](v1/README.md) 各节。

## 团队运行消息继续原工作

Workbench 对 `source.system=weave` 的原生消息，以当前 Forge/Weave 登录员工身份调用 `GET /v1/runs/{runId}/workbench-context`。Weave 只从该员工本人已消费的 `weave_dispatch_input_revisions` 找到运行，按 `workbenchRunAccess` 同一归属规则拒绝他人；不得凭客户端传入的员工、材料或记录 ID 扩权。返回值符合 [work-continuation](v1/work-continuation.schema.json)。其中 `source.input_revision_id/run_id/workbench_session_id` 必须分别与消息的 `workReference/runReference/sessionReference` 完全一致，桌面才可把上下文交给 Pi；消息标题和摘要不作为权威输入。401 表示登录无效，404 表示运行不存在或不属于当前员工，503 表示权威读取不可用；缺失或不匹配的固定输入不得退化成消息正文继续。

ObjectStack 17.3 原生 `GET /api/v1/notifications` 按当前员工返回消息，但会省略 `sys_notification.payload.weaveEvent` 中的来源引用。Workbench 在点击 `weave.team_run.*` 消息时，以当前 Forge 登录身份调用 `GET /api/v1/workbench/notifications/{notificationId}/source`；Forge 现有 Weave 事件插件先核对原生 `sys_inbox_message` 的 `notification_id`、`user_id` 与当前员工，再从该原生通知的 `payload.weaveEvent` 投影 [team-run-notification-source](v1/team-run-notification-source.schema.json)。非收件人或无对应事件返回 404，不提供按他人账号列消息的接口，也不复制收件箱状态。得到三引用后，桌面继续向 Weave 核对原运行；任一环节失败则保留消息，不转为自由文本继续。

`input.materials` 只是原任务已验证的 Forge 文件引用和摘要：`bytes` 是原件大小，最多 2 MiB，不是响应正文；原件正文不进入 continuation JSON。PDF/DOCX 引用冻结 `materialId`、`mediaType`、`sourceKind`，approval 来源还带 `requestId`；`input.task` 仍使用既有 1 MiB 上限。需要原件时仍以当前员工的 Forge 权限读取并重新校验字节。ObjectStack 17.3 原生存储下载接口对未关联业务记录的 `scope:user` 文件未调用文件读取授权钩子，因此 Workbench 不能直接用它续接材料；Forge 插件提供仅限原文件所有人的受控读取，仍使用原生 `sys_file` 与存储服务，不复制文件。正式审批材料继续由已有审批上下文按请求快照读取。若材料读回失败、长度或摘要不匹配，桌面不得把文件 ID 或通知摘要交给 Pi 当作原文。

Workbench 新上传的团队材料使用 ObjectStack 原生 `scope=attachments`，使原生下载路由进入 `authorizeFileRead`；其原生授权会优先核对当前文件所有人。Workbench 对每个原工作 `forge-file` 引用，调用 `GET /api/v1/workbench/materials/{fileId}` 取得有长度与 SHA 校验的文本内容。Forge 插件从当前登录会话确定用户，只读取 `sys_file` 中 `scope=attachments` 或已有的 `scope=user`、`acl=private`、`status=committed` 且 `owner_id` 等于该用户的未绑定文本文件；由原生 storage 服务读原始字节，校验元数据长度，计算 SHA-256，按 [owned-text-material](v1/owned-text-material.schema.json) 返回。Workbench 再与 Weave 固定输入的文件 ID、名称、字节数、摘要逐项比较，全部一致才将原文交给 Pi。未登录返回 401，非所有人或不存在返回 404，超限返回 413，格式不支持返回 415，字节不一致返回 422，服务不可用返回 503；响应禁用缓存。调用方不能借此读取其他员工文件或审批文件。

已存的 `scope=user` 工作材料仍可能通过 ObjectStack 17.3 原生文件 URL 路由绕过读取钩子；新插件不能替该原路由撤销已签发的 URL。124 本轮按用户要求全新初始化 Forge/Weave 应用及业务卷，旧文件会一并删除，不迁移旧内容；必须独立验证新上传使用 `attachments` 后，其他员工与匿名请求均不能从原生 URL 读取。若其他部署要保留旧数据，则先按 Weave 固定输入清单盘点确切文件，验证以原生元数据能力迁到受钩子保护的范围；未验证前不能关闭 C01 材料权限。不能批量修改其他业务的个人文件，也不改 ObjectStack 源码。

团队运行状态、团队最终产物与 Forge 正式业务回执分别呈现。此只读响应不授予新的写动作；员工提出补充或修改时建立新轮次，按当前权限重新固定输入。继续原团队工作时必须复用服务端返回的 `workbench_session_id`、`input_revision_id`、`team_id`，将本次 `expected_revision_id` 指向当前输入，`revision_context.parent_input_revision_id/parent_run_id` 指向所打开的原输入与运行；若服务端 head 已变化，应提示刷新并重新选择当前工作，不把结果另起为无关联任务。正式审批消息继续使用原生 [审批上下文](v1/approval-context.schema.json)，不走此接口。取消已经发生的业务动作依 Forge 规则处理。

## 原生审批上下文

Workbench 使用当前 Forge 登录会话读取 `GET /api/v1/approvals/requests/{requestId}/workbench-context`。客户端不能提交员工 ID、对象 ID 或文件 ID。Forge 先通过原生 ApprovalService 验证当前员工是该 pending 请求的审批人，或是 returned 请求的原提交人，然后只投影该审批快照中的字段和文件。

材料只支持纯文本，每份最多 2 MiB、每个审批最多 11 份；Forge 必须将下载字节与审批快照中保存的 SHA-256 比较后才返回内容。摘要缺失或不一致时失败关闭，不使用当前记录或通用文件 URL 回退。桌面端只显示契约允许的错误，不回显 Forge 错误正文。该端点只读取退回上下文，不执行业务状态转换。退回后的修订材料应由 Forge 业务动作校验和递交，成功后由业务流程继续原审批；桌面让员工通过 Pi 表达这项业务意图，不暴露底层审批状态操作。

错误状态：`401` 表示登录无效，`404` 表示请求不存在或当前身份不具备读取资格，`409` 表示审批状态已变化，`413` 表示材料超限，`415` 表示材料格式不支持，`422` 表示上下文或冻结材料无法安全校验，`503` 表示读取服务暂不可用。客户端只按状态和稳定错误码映射提示，不展示服务端自由文本。
