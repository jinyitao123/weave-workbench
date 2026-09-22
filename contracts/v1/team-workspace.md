# DEV-02 团队工作台

桌面定义、试跑、发布共同编辑 Weave 中的一份团队草稿。成员配置、团队说明、流程及材料输入关系都属于该草稿，保存不会激活线上版本。

- 调用者：Forge 已授予 teams:develop 的当前 Weave 用户；服务端逐次验证组织与团队归属。
- GET /v1/teams/:id/development 读取 revision、document、prepared_revision、trials 和线上基线。PUT 接收 expected_revision 与完整 document，使用 CAS；过期返回 409。只有用户明确保存才提交 PUT；编辑、字段失焦、切换页面、退出组件和调试不得隐式提交。保存只提交点击时的快照，之后的编辑保持未保存；CAS 不得覆盖并发修改。
- document 包含 name、objective、members（现有成员标识或新成员临时标识、configuration、relationship）、workflows（标识、名称、用途、graph_definition、trigger_config）。删除仅从草稿移除；服务端发布时保留历史并归档。
- POST /v1/teams/:id/development/trials 接收 revision、workflow_id、request_id（UUID）和固定 input 文本。服务端解析并冻结成员与流程，不改变已发布配置；复用 Kernel AdmitCandidate、队列、取消和运行记录。重复请求必须复用原配置和材料，改变内容返回冲突。
- 试跑首版仅开放无外部业务副作用的 Loom 团队；未隔离的外部工具或业务写入明确拒绝，不移除能力后冒充完整试跑。input 支持员工授权文本样例；不借用另一员工身份。
- GET 运行 activity/delivery 显示实际输入来源、版本和输出；摘要须标记为摘要。完整原始输入单独按当前试跑权限读取。
- POST /v1/teams/:id/development/publish 接收 revision，要求每个待发布流程存在相同草稿的成功试跑。固定 candidate 发布、可重复恢复；所有流程和成员一次激活。失败不部分切换线上目录。试跑后修改使原结果过期。
- DELETE /v1/teams/:id/development/team 为可追溯退役，不抹除版本、运行或成果；正在执行的工作沿用冻结版本。
- 审计包含当前主体、组织、草稿修订、冻结候选摘要、试跑及发布回执；不保存长期凭据。

桌面只提供编辑与观察，不建立第二套运行队列。步骤输入支持原始材料与多个上游成果并存；执行绑定由 Weave 校验，不通过模型转抄。

## 场景与编辑器边界

团队、成员职责、流程及输入绑定由远端开发定义提供。桌面不得按合同、采购等场景写死成员、审批或模型。现有文本调试只是首版能力范围；结构化输入、外部工具隔离和实际 Loom 拓扑未接通时须明确保留为缺口，不能用场景专用指令或示意图宣称对应能力已开放。
