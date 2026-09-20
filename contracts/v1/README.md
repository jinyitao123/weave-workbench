# 契约 v1

这些契约只描述跨组件传递的信息，不规定 Forge 内部对象结构或 Weave 内部执行方式。

所有请求都带有用户、组织和短期委托。所有会产生业务影响的动作都带有幂等键。执行结果允许明确表示“结果未知”，此时 Weave 必须先向 Forge 核对，不能直接重试。

材料通过受管理的引用传递。桌面本地路径不能直接成为远程系统可读取的材料地址；上传后用摘要校验内容是否一致。

## 企业身份会话

`enterprise-session.schema.json` 是桌面可见的账号投影，`account-binding.schema.json` 描述 Forge 账号到 Weave 用户的稳定绑定；两者都不包含密码、Cookie 或 Bearer Token。`task-delegation.schema.json` 描述任务范围内的短期授权。

- 调用者：Workbench Host 调用 Forge 登录和 Weave 绑定接口；界面只读取账号、组织和 Weave 角色投影。
- 身份来源：Forge 注册并验证账号，Weave 以 `issuer + subject + organization` 建立本地绑定。桌面不创建第二套账号。
- 单次登录：Workbench Host 把一次性账号密码请求发给 Forge，随后把 Forge 会话交给 Weave 验证并换取产品会话。渲染进程不保存密码，Weave 不接收或保存密码。
- 自动绑定：首次登录创建默认 `member` 用户；重复登录返回同一 Weave 用户且不覆盖管理员设置的角色；不同组织或身份来源不能按邮箱合并。
- 产品权限：Weave 直接用自身 `member / developer / admin` 控制团队使用、配置、调试、发布与平台管理。MVP1 不维护第二份能力投影，也不依赖外部权限引擎。
- 业务权限：Forge 对每次业务动作继续执行自身权限判断。Weave 角色不能扩大 Forge 数据和流程权限。
- 保存方式：设备会话令牌只允许由系统安全存储加密落盘。安全存储不可用时只保留到本次进程结束。
- 传输：Workbench 按部署配置连接 HTTP 或 HTTPS，账号投影中的 `environment.secure` 明确标识当前连接方式；客户内网可直接使用 HTTP。
- Weave 委托：身份提供方的长期会话令牌不得进入团队执行。由 Weave 接入与权限模块签发短期、限定动作、资源、任务和有效期的委托。
- 失效：Forge 返回 401 或 403 时，桌面清除本地会话并回到未登录；退出登录同样清除本地会话。
- 审计：登录、退出和委托签发记录主体、组织、设备会话、时间和结果，不记录密码与令牌正文。
