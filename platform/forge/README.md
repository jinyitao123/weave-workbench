# Forge

Forge 面向制造企业提供供应链、销售、生产、项目、行政、财务、报表七个业务应用，每个应用有自己的业务设置，并共享原生身份、组织、审批和业务数据。2026-09-23 起 RISEMAP 作为产品参考，Forge 的目标与验收依据由用户需求、业务规则和自身页面合同确定。

## 当前仓库与交付状态

- 当前源码仍在 [apps/forge-objectstack](apps/forge-objectstack/README.md) 集中注册一个 Forge 应用；七应用拆分为已确定设计，尚未实施。
- 已有对象、动作、页面和验证脚本；入口存在、接口可调用、历史检查通过均不等于当前功能可交付。
- [页面清单](apps/forge-objectstack/tests/page-polish.manifest.json)保留待复核状态，缺失与不通功能须按实际业务结果核查。旧双侧像素门禁向新准则的迁移尚待实现。
- 应用划分、各应用设置、缺口修复与性能总体方案由产品总仓 `weave-workbench/docs/architecture/Forge应用与性能设计.md` 维护，本仓交付实现与证据。

## 开始工作

1. 读[项目规则](AGENTS.md)，按改动面使用项目 Skill。
2. 页面工作读[交付标准](docs/forge-page-delivery-standard.md)、[视觉与交互基线](docs/forge-page-polish-baseline.md)和[模板](docs/templates/forge-page-delivery.md)。
3. 从[文档索引](docs/README.md)定位业务合同与实际证据。RISEMAP 资料可选，不能用其缺失阻断明确业务需求。
4. 按[应用说明](apps/forge-objectstack/README.md)选择独立环境；有并发时隔离分支、worktree、端口和持久数据库。

## 交付边界

已采纳的功能必须具备正常办理、关键异常、权限、正式数据与关联、下一步、持久化和独立回读。缺口不得通过隐藏控件删除，参考降级不会自动把 review_required 改成 accepted。

[客户系统组合设计](docs/forge-customer-composable-architecture.md)维护 Forge 与客户既有系统的能力分工；[正式交付要求](docs/first-release.md)约束客户开通、恢复与持续使用。设计、实现、验证和部署分别说明。

## 资料入口

- [RISEMAP 参考使用规范](docs/risemap-replication-spec.md)
- [参考功能域材料](docs/risemap/README.md)
- [三类业务定义](docs/business-model.md)
- [客户业务材料](docs/customer-meeting-20260907-findings.md)
- [历史归档](docs/archive/README.md)
