# 分支与工作树收拢记录

日期：2026-09-21。

## 结果

- Weave 的产品账号接入、团队成员配置草稿、运行时修复、MCP 建队修复和掼蛋智能体能力已收拢到源码主仓 `main`。
- inoForge 的页面休整和已撤回的 OAuth 试验历史已收拢到源码主仓 `main`；最终产品路径仍是 Forge 验证身份、Weave 自动绑定账号。
- Loom 与 GooeyPi 的现有功能分支此前已包含在各自主线，本轮仅核对，没有产生代码合并。
- 总仓已同步确定的 Weave 与 Forge 来源提交，组件副本与版本锁一致。

## 验证

- Weave 的 API、daemon、engine、runtime、teamrun 和 MCP 定向测试通过。
- Weave 全仓 Go 包均通过；`go test ./...` 仍会把中文路径下的历史探针目录识别成非法 Go 导入路径，因此命令以该已知仓库结构问题返回失败。
- GooeyPi 桌面类型检查和生产构建通过。
- 总仓 `make component-check` 通过，Weave 与 Forge 均无集成偏差。

本记录只证明本地源码与工程工作树完成收拢，不代表远端分支已推送、服务已重新部署或 MVP1 跨系统业务闭环已经验收。
