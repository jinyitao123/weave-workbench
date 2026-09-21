# GooeyPi MVP1 登录验收

日期：2026-09-21。结论：工程验证通过，真实账号闭环待补应用密码。

## 已通过

- GooeyPi 桌面展示唯一 Forge 账号密码入口，明确当前内网 HTTP 环境；不再启动旧 DSH 登录页。
- Electron 主进程调用 Forge `sign-in/email`，随后调用 Weave `auth/external/exchange`；密码和令牌不进入渲染进程。
- Weave 会话可由操作系统安全存储加密并在重启后恢复；退出登录删除保存内容。无安全存储时仅保留当前启动周期。
- `member` 不显示开发中心，`developer` 和 `admin` 显示开发中心；真正权限仍由服务端执行。
- Node 24 下桌面类型检查、生产构建和全部 167 个测试文件通过，共 1935 项通过、1 项跳过。
- 本机原生 Electron 已打开 GooeyPi 登录页，地址显示 `http://124.223.189.112 · 内网 HTTP`。

## 尚未通过

- 尚未使用 `admin@inoforge.local` 完成真实登录，因为当前会话只有 SSH 密码，没有 Forge 应用密码。
- 因此首次绑定、重启读回、重复登录、角色变更保持和停用拒绝还不能记为端到端通过。
- Forge 自助注册返回 `SELF_REGISTRATION_CLOSED`，符合邀请制配置，没有创建临时账号绕过验收。

## 清理门槛

真实账号链路通过后，将 GooeyPi 当前树合入远端 `main`，使主线工作树不再包含旧 DSH `apps/`、`packages/` 等入口；随后关闭旧登录分支并移除本地旧 DSH 工作树。旧提交历史保留用于追溯，不作为可运行产品入口。
