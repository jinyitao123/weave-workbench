# Forge

Forge 以 RISEMAP 的可观察业务行为为复刻基线，在 ObjectStack Console 内交付统一的业务页面和岗位办理流程。完整复刻后再开展 OEM 适配，汇川 OTC 用于检查跨模块连续性，不替代 RISEMAP 页面证据。

## 当前仓库

- 可运行应用位于 [apps/forge-objectstack](apps/forge-objectstack/README.md)，使用 TypeScript 与 ObjectStack；具体依赖和命令以 [package.json](apps/forge-objectstack/package.json) 为准。
- 已有业务对象、动作、页面与验收脚本，但实现存在、页面可打开和历史脚本通过都不等于全量复刻或正式交付完成。
- 页面设计状态见 [页面清单](apps/forge-objectstack/tests/page-polish.manifest.json)；业务结果必须结合对应版本的页面合同和双侧验收证据判断。当前有效资料与历史快照的区别见[文档索引](docs/README.md)。

## 开始工作

1. 阅读[项目规则](AGENTS.md)，按改动面加载项目 Skill。
2. 页面开发或精修读取[默认交付标准](docs/forge-page-delivery-standard.md)、[页面精修基线](docs/forge-page-polish-baseline.md)，并使用[逐页交付模板](docs/templates/forge-page-delivery.md)。
3. 从[文档索引](docs/README.md)进入当前业务合同与取证材料；只读取任务相关资料，不把整套历史记录当作启动上下文。
4. 本地安装、开发命令与验证说明见[应用说明](apps/forge-objectstack/README.md)。并行任务使用独立分支、工作树、端口与 SQLite，主线负责集成。

## 目标与边界

全量范围包括导航、页面、字段、状态、操作反馈、业务关联、权限、异常恢复、配置、报表和可用集成。没有成功完成 RISEMAP 同材料办理的路径，仍保留待复核状态。

新增页面既要遵循 RISEMAP 业务事实，也要达到工作台、任务管理和工时管理参考页的信息层级与办理体验；复用共享样式不能替代逐页精修和真实操作验收。

正式客户交付还须满足[首个正式版本交付要求](docs/first-release.md)。部署、客户隔离、恢复和实际使用是否通过，按发布版本另行证明，不能由本首页推定。

## 资料入口

- [当前文档与状态来源](docs/README.md)
- [RISEMAP 完整复刻与采集标准](docs/risemap-replication-spec.md)
- [RISEMAP 功能域走查](docs/risemap/README.md)
- [三类业务定义与流程](docs/business-model.md)
- [客户会议与业务痛点](docs/customer-meeting-20260907-findings.md)
- [历史计划与技术选型归档](docs/archive/README.md)

首页整理于 2026-09-16；本文是导航入口，不是动态运行状态或业务验收报告。
