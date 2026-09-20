# 企业身份桌面切片验证

日期：2026-09-20。范围：MVP1 / ENV-01 的桌面端账号入口与安全会话，不代表三方统一身份或 E1 已完成。

## 本次可见行为

- 开发中心新增“账号与权限”入口。点击登录后打开 Forge 统一登录页，通过 OAuth 授权码、PKCE 和本机回环地址返回桌面；账号身份通过标准 UserInfo 端点读回，桌面不显示邮箱密码表单。
- Forge 可配置为 HTTP 或 HTTPS；客户内网使用 HTTP 时登录按钮保持可用，界面明确显示“当前通过 HTTP 连接”。
- 密码、验证码和企业单点登录凭据只由 Forge 网页处理。设备会话由 Electron `safeStorage` 加密后落盘；安全存储不可用时只保留到本次进程结束。
- 渲染页面只能读取经过裁剪的账号投影，无法取得 Bearer Token。

## 当前验证

- `npm run typecheck`：通过。
- `npm run check`：通过。
- `npm run build:bundle`：通过，主进程、preload 与 renderer 均成功构建。
- `vitest`：在项目支持的 Node.js 24.19.0 下，桌面全量 166 个测试文件通过，1935 项通过、1 项跳过；其中企业身份服务 7 项覆盖内网 HTTP 登录、浏览器 OAuth/PKCE/回环回调、UserInfo 投影、组织与角色声明、声明缺失、令牌加密落盘和重启读回。
- 桌面正常路径：已实际打开“开发中心 → 账号与权限”，确认只显示“登录企业账号”浏览器入口；HTTP 环境显示当前连接方式且登录按钮可用。
- Forge 独立分支：`typecheck`、`validate`、`build` 通过；构建仍报告既有页面 author-time 警告，本次未将其写成身份验收通过。
- 线上 HTTP 实测：OAuth 发现文档 200，动态客户端注册 201，授权页识别现有 `admin@inoforge.local` 会话，授权码回调与令牌交换成功；Workbench 通过 UserInfo 读回用户标识、名称和邮箱，并将设备会话加密保存。
- 线上权限实测：当前登录只申请了 UserInfo 身份令牌；该令牌调用组织和通用数据接口返回 401，符合不同资源令牌不能混用的边界。桌面不据此推断组织和角色，明确显示等待 Forge OAuth 提供；MCP 资源令牌尚未在 HTTP 环境签发和验证。

## 尚未完成

- 线上 Forge 的浏览器 OAuth 已可用，但发现文档中的 `issuer` 仍是 HTTPS，与当前 HTTP 入口不一致，需要修正部署配置。
- ObjectStack 当前 UserInfo 只返回基本用户声明，未返回组织与角色。ObjectStack 17.4.0 又会在非本机 HTTP 环境关闭 MCP OAuth；默认关闭、精确值开启的原生补丁已进入草稿 PR #19342，目标测试 42 项通过，但完整仓库检查和运行镜像尚未完成。ENV-01 需在原生身份投影和 HTTP MCP OAuth 能力发布后才能完成。
- Forge 到 Weave 的短期任务委托尚未实现；Forge 长期会话令牌不会直接交给 Weave。
- 尚未以员工、开发者、处理人和审计者完成越权拒绝和跨组件业务验收，因此 ENV-01 仍为进行中。
