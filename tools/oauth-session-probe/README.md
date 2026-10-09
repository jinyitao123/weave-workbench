# OAuth 会话衔接隔离探针

本目录只验证“原生OIDC浏览器登录后，签发独立的Forge桌面会话，再沿用既有业务接口和Weave身份交换”。`session-bridge.mjs` 不在Forge产品配置中注册，不修改ObjectStack依赖或Weave代码，不能直接作为生产登录实现部署。

`run.mjs` 是环境和验证脚本，只有 `session-bridge.mjs` 是被验证的衔接改动。脚本中的一次性客户端配置入口仅存在于临时副本，要求真实原生管理员权限，并调用原生 `adminCreateOAuthClient`；普通客户端匿名注册不会启用本实验所需的sid输出。浏览器通过独立Chrome上下文操作原生登录页和授权页，桌面Host由脚本代替，不代表GooeyPi界面已经接入。

实验输入、输出、取消、错误、单次消费和审计边界见[实验契约](../../contracts/v1/README.md#桌面-oidc-会话衔接隔离实验)，实测结果见[环境证据](../../docs/environments/开发联调环境.md#桌面-oauth-本地隔离验证)。原型通过依赖 `getAuthContext().internalAdapter.createSession`，正式接入前须确认平台支持边界和并发撤销语义。

复现入口为 `node tools/oauth-session-probe/run.mjs`。要求本机PostgreSQL可用、Go可构建Weave、已安装Chrome、桌面Playwright依赖，以及与组件锁匹配的Forge依赖。用 `FORGE_PROBE_NODE_MODULES=<Forge应用依赖目录>` 指定来源仓的匹配依赖；可通过 `PGPORT`、`PGUSER` 选择本机PostgreSQL。脚本仅连接本机回环数据库，创建独立数据库和源码归档，最后清理进程、数据库与临时文件。测试密码和令牌在内存中生成，不输出。

来源提交 `5d1e18225471ae731e0fb0d24cba9e8a99eaa3c6` 记载2026-10-08本地13组验证全部通过（本轮未复跑），包括原生元数据校验、两组身份的权限对照、Weave绑定、退出及负向身份检查。详细状态码和未验证项仅维护在环境证据中。此目录未加入产品启动或发行构建。

`internalAdapter` 是内部接口，不是已确认的公开稳定接入边界。并发撤销、跨进程重放恢复、正式桌面入口均未验；本轮只做源码归并及语法检查。
