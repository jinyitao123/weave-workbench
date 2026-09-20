# 历史文档归档

归档日期：2026-09-16。这里保存已被当前项目方向或实现阶段替代的计划和选型记录，不作为当前任务队列、技术候选或验收结论。当前入口见[文档索引](../README.md)。

## 迁移清单

清理前基线：`a040b38`。以下正文均保留，仅增加历史说明、修复相对链接及清理行尾空白；原始字节可从该 Git 提交按原路径读取。

| 原路径（仓库相对） | 归档位置 | 原因 |
| --- | --- | --- |
| README.md | [原项目首页](2026-09-08/project-overview.md) | 首页仍描述无可运行应用、未定技术栈和旧首版范围；现首页已重写 |
| docs/v1-replication-plan.md | [首版建议](2026-09-08/v1-replication-plan.md) | 柜机优先及缩小范围的建议已被完整复刻目标替代 |
| docs/objectstack-assessment.md | [框架初评](2026-09-08/objectstack-assessment.md) | 保留采用前的核查快照，不再代表尚待选择框架 |
| docs/objectstack-deep-dive.md | [源码拆解](2026-09-08/objectstack-deep-dive.md) | 保留固定版本技术调查，不作为当前运行证明 |
| docs/steedos-solution-assessment.md | [华炎魔方方案核查](2026-09-08/steedos-solution-assessment.md) | 保留早期候选来源，不作为当前实施方案 |

两份根目录与应用目录说明中的旧内容仍可在清理前提交回查。应用说明移除了过时的数量、固定登录凭据和未经本次验证的脚手架能力承诺，不改变实际环境配置。

## 原位保留但取消“当前”权威的记录

以下文件仍被业务材料引用，因此不移动或删除：

- [旧验收矩阵](../forge-verification-matrix.md)与[滚动交接](../risemap-rolling-handoff.md)：增加历史边界，保留原始结果。
- [页面产品化](../forge-productization-plan.md)、[产品恢复](../risemap-product-recovery-plan.md)、[结构恢复](../risemap-product-structure-recovery-plan.md)：增加阶段方案说明，不再指挥当前开发。

## 保留与恢复

RISEMAP 原始截图、DOM、来源记录、业务页面合同、验收记录、标准测试材料和正式交付要求未删除。进行中的财务、供应链工作树、数据库和服务未调整。

查阅归档正文即可恢复历史背景；需要精确原文时，按清理前提交及上表原路径读取 Git 版本。若需撤回本次整理，应只恢复本次文档变更，不覆盖后续业务开发提交或用户改动。
