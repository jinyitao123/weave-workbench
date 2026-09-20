# 产品能力投影实现记录

日期：2026-09-20。范围：ACCESS-01 第一段工程实现，不代表真实账号端到端验收完成。

## 已实现

- 总仓固定 `product-capabilities`、`authorization-evaluation` 和 `task-delegation` 三份 v1 契约。
- 桌面账号页展示五项产品能力的允许、拒绝、待接入和服务端原因；不再把 Forge 角色显示为产品权限结论。
- 桌面只投影接入权限服务的返回。接口缺失、拒绝或不可用时，五项能力全部按 `unavailable` 处理。
- Weave 独立工作树 `/Users/jinyitao/Developer/weave-next-product-access` 增加 `GET /v1/authorization/capabilities`。第一版复用现有 Weave 角色与 API key scope；可写沙箱在真实环境接入前固定拒绝。实现提交为 `5772c2d8`，已推送至草稿 [weave-next PR #5](https://github.com/jinyitao123/weave-next/pull/5)。

## 验证

- Workbench：账号后端与界面 9 个定向测试通过；在项目支持的 Node 24.19 下，全量 167 个测试文件通过，共 1937 项通过、1 项跳过。TypeScript 类型检查、静态检查、契约 JSON 解析和结构检查通过。
- Weave：`make test`、`make depguard base-depguard productguard` 通过。

## 尚未验收

当前桌面会话由 Forge OAuth 适配器签发，Weave 接口使用自身身份。两者之间的身份交换或外部令牌验证尚未实现，因此线上员工和开发者账号还不能读到 Weave 的真实判断。下一段应先补身份适配，再做双账号桌面验收；不能把组件测试写成端到端完成。
