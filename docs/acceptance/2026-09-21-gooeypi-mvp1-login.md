# GooeyPi MVP1 登录验收

日期：2026-09-21。结论：真实账号登录、首次绑定、重复登录和角色呈现通过；开发启动方式下的会话自动恢复仍待发布包验证。

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

## 未完成项

- 当前 `electron-vite dev` 启动中，操作系统安全存储没有生成新的可恢复会话；重启后再次输入同一 Forge 账号密码可正常登录。发布包的加密会话恢复还需单独验证。
- 尚未在真实环境执行账号停用后的拒绝验证，避免影响当前唯一管理员账号。
- Forge 开发密码保存在本机 macOS 钥匙串，不写入仓库、文档或日志。

## 清理门槛

将 GooeyPi 当前树合入远端 `main`，使主线工作树不再包含旧 DSH `apps/`、`packages/` 等入口；随后关闭旧登录分支并移除本地旧 DSH 工作树。旧提交历史保留用于追溯，不作为可运行产品入口。
