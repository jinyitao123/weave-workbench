# 工程交接基线验证

日期：2026-09-20；工作项：ENG-01。范围仅为架构文档、接手规范、版本来源检查、Make 入口和根 CI 配置。

## 被检查现场

- 总仓 HEAD：`fb6d78b39340d75fa4f1cee0138420085506729f`，分支 `codex/product-shell`，工作树不干净。
- 环境：macOS / arm64，Node `v25.6.1`。CI 配置指定 Node 24，远端尚未执行。
- Weave 来源：`da22429df6f74a2a29a7cd00ec0d72416f47400d`；Forge 来源：`cfe4d44218cc44772f1d9d40befa687b466e2774`。本轮未更新来源锁。
- 接手时已存在桌面产品、环境说明和 Weave 修复等未提交成果，本轮没有修改桌面或组件业务源码。新增和修改的工程文件仍在本地工作树，未提交或推送。

本轮工具内容的 Git blob 摘要（由 `git hash-object` 读取，便于后续核对未提交版本）：

| 文件 | 摘要 |
| --- | --- |
| `tools/project-status.mjs` | `497942f8d724cc7d0f5a9828378fd59319f90b72` |
| `tools/project-status.test.mjs` | `098bc3ab953787331f016270be72caa3d36d6c70` |
| `tools/check-layout.mjs` | `84d96e4e60136a5e9c6e60ca82a10ef22523a91c` |
| `Makefile` | `c8a7cf1d4a0a323b43b1ed3660f5c75a361efbfb` |

## 实际结果

| 检查 | 结果与含义 |
| --- | --- |
| `make check` | 通过：结构、锁定路径/提交、文档本地链接目标和 4 项工具回归；链接检查不覆盖锚点和外部网址 |
| `make status` | 通过：能读出真实分支、HEAD、无远端、已有未提交文件以及组件偏差 |
| `make component-check` | 预期阻断，make 退出码 2：Weave 的 `store.go` 和未跟踪的 `store_pg_test.go` 待处理；Forge 来源一致 |
| `make release-check` | 预期阻断，make 退出码 2：工程检查通过，但存在组件补丁与未提交工作，不能宣称是干净的候选发布版本 |
| `make -n forge-check weave-check` | 展开正确：Forge 指向实际应用目录的 typecheck / validate，Weave 包含测试和两项依赖边界检查；本轮没有执行组件检查 |
| `git diff --check` | 通过 |

4 项工具回归覆盖干净来源、产品改动与组件改动的区分、已暂存/未暂存/未跟踪组件文件、已提交但未回流的补丁、来源对象缺失、错误导入路径，以及只读盘点不更改 Git 索引。测试临时仓库在结束时删除。

## 未验证与后续

没有重跑桌面或组件全量验收，没有同步独立仓库、创建远端、推送、部署或验证线上业务。本轮结果只证明接手与版本检查工具可用。后续工作由[项目状态](../project-status.md)统一维护，优先处理 SYNC-01 回流项。
