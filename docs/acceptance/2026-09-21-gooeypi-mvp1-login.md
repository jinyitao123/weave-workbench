# GooeyPi MVP1 登录验收

日期：2026-09-21。结论：真实账号登录、首次绑定、重复登录、角色呈现和加密会话恢复通过。

## 已通过

- GooeyPi 桌面展示唯一 Forge 账号密码入口，明确当前内网 HTTP 环境；不再启动旧 DSH 登录页。
- Electron 主进程调用 Forge `sign-in/email`，随后调用 Weave `auth/external/exchange`；密码和令牌不进入渲染进程。
- Weave 会话可由操作系统安全存储加密并在重启后恢复；退出登录删除保存内容。无安全存储时仅保留当前启动周期。
- `member` 在侧栏和命令面板都不能进入开发中心，`developer` 和 `admin` 显示开发中心；真正权限仍由服务端执行。
- Node 24 下桌面类型检查、生产构建和全部 167 个测试文件通过，共 1935 项通过、1 项跳过。
- 使用 `admin@inoforge.local` 从本机原生 GooeyPi 完成 Forge 登录；桌面端没有第二套账号入口。
- Forge 主体 `MGi3XFcoihWShlwgwAytQwtE7ogFXfjn` 首次登录自动绑定到 Weave 用户 `ext_149278a6597ade6d17c8b42cfd4a8bb9`，重复登录保持同一绑定。
- 新绑定默认得到 `member`；在 Weave 调整为 `admin` 后重新登录，桌面端显示 `admin` 并出现“开发”入口。
- Forge 与 Weave 环境探测均显示可用；当前 Forge 地址显示为内网 HTTP。
- macOS 本地 QA 包通过 DMG、ZIP、原生模块架构、Electron fuses 和包体预算检查。
- 使用与桌面主进程相同的 `EnterpriseService` 和 Electron `safeStorage` 做两次独立进程验证：首次真实登录写入权限为 `0600` 的密文会话，第二次不读取 Forge 密码即可恢复 `admin` 登录态。

## 未完成项

- 尚未在真实环境执行账号停用后的拒绝验证，避免影响当前唯一管理员账号。
- Forge 开发密码保存在本机 macOS 钥匙串，不写入仓库、文档或日志。

## 主线清理

GooeyPi 当前树已成为远端 `main`。主线根目录不再包含旧 DSH 的 `apps/`、`packages/`、`native/` 等入口；旧 DSH 登录分支和两个旧接入工作树已经移除。相关提交已作为合并历史保留用于追溯，不再作为可运行产品入口。
