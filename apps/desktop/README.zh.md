---
description: "运行连接真实本机 Workbench Host 的 macOS 桌面产品。"
kind: "package-reference"
---

# Weave Workbench 桌面端

[English](README.md) | 中文

Electron 是 Workbench 的正式产品入口。应用启动时会在自己的数据目录中启动本机 Workbench Host，并直接加载 Host 返回的一次性认证地址。用户随后通过正常账号页面登录；平台令牌只保存在 Host 内存中，浏览器窗口仅持有 HttpOnly 会话 Cookie。用户与工作区身份由平台登录结果确定，不要求用户填写服务地址或工作区标识。

```sh
pnpm install --frozen-lockfile
pnpm run build:workbench
pnpm run desktop:dev
pnpm run desktop:test
```

`desktop:dev` 启动真实桌面产品。它读取 `WEAVE_API_URL`、`WEAVE_API_KEY`，在 macOS 上也可从 `weave-workbench-api-key` 钥匙串服务读取 Host 密钥。默认数据目录是 `~/Library/Application Support/Weave Workbench`；关闭桌面应用会停止它启动的 Host。

产品窗口保留 Workbench 的正常页面和权限边界，包括账号登录、项目选择、会话、设置和执行页面。渲染进程没有 Node、文件系统或 shell 权限；Host 负责平台身份、工作区归属、会话、工具和模型设置。

`--fixture-preview` 只供桌面壳回归测试使用。它运行隔离的合成服务选择场景，不是正式入口，也不能作为账号、项目或业务执行验收依据。`desktop:test` 会先运行这组壳层回归，再启动真实 Host，通过正常登录路径验证项目选择、账号菜单和设置页面。

当前源码运行路径已经接入真实 Host。现有 `desktop:package` 尚未把完整 Host 运行时嵌入 `.app`，因此不能把该产物作为可分发桌面版本；完成独立运行时装配、签名与公证后再进行发行验收。
