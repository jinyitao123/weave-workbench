# Forge 文档索引

维护日期：2026-09-16。这里负责选择资料入口，不维护另一份全站“已完成”清单。项目规则、业务事实、代码实现与验收结论分别取证，历史文档里的“当前”不代表今天。

> 现行视觉验收以 RISEMAP 实时页面的同视口截图为基准，要求逐页保存 RISEMAP、Forge 和差异图并满足像素及几何阈值。旧文档中任何“样式差异可接受”“不追求像素级一致”或仅凭共享样式、页面可打开即通过的说法均已废止，只能作为当时记录，不能用于当前验收。

## 开发时的最短阅读路径

1. [项目规则](../AGENTS.md)：复刻边界、实时对照、实施顺序、持续执行和门禁。
2. 页面工作读取[交付标准](forge-page-delivery-standard.md)与[精修基线](forge-page-polish-baseline.md)。
3. 按本次业务范围读取页面合同和 RISEMAP 对应材料；新增合同使用[逐页模板](templates/forge-page-delivery.md)。
4. 按修改面加载仓库的项目 Skill；规则路由见项目 AGENTS.md。不默认重读所有合同、历史交接或截图。

## 当前状态怎么判断

| 问题 | 应核对的资料 | 不能据此推定 |
| --- | --- | --- |
| 当前有哪些入口与实现 | [导航注册](../apps/forge-objectstack/objectstack.config.ts)、[页面注册](../apps/forge-objectstack/src/pages/index.ts)与对应源文件 | 入口存在不代表功能完整 |
| 设计是否通过 | [页面设计清单](../apps/forge-objectstack/tests/page-polish.manifest.json)、其中引用的逐页合同与版本化验收记录 | 共享样式、参考页身份或截图存在不代表 accepted |
| 业务是否闭环 | 当前链的合同、双侧同材料操作记录、API 与同库重启回读证据，以及受验代码版本 | 历史矩阵或分支报告不代表当前 main 已通过 |
| 尚有哪些复刻入口缺口 | [RISEMAP 功能清单](risemap-feature-inventory.md)、[原始页面契约](risemap-page-contracts.md)、实时 RISEMAP 页面与当前 Forge 导航联合核对 | manifest 不覆盖全部内部表单、详情、弹窗和标准对象页 |
| 能否正式交付客户 | [正式版本交付要求](first-release.md)及本次发布证据 | 构建成功或容器文件存在不代表发布验收 |

全站业务状态尚未在本次文档整理中重新验收。缺当前版本证据的项保留待复核；不能简单将旧缺口删除，或凭新合同存在改成通过。

## 本轮主要业务入口

以下文档是进入业务工作的索引，均保留各自日期和代码边界；不把旧端口、旧分支或其中的首批顺序当成新任务指令。具体批次以用户当前目标和对应工作分支的最新合同为准。

| 范围 | 合同与盘点入口 |
| --- | --- |
| 财务全量精修 | [财务页面清单](forge-finance-page-inventory-20260915.md)、[财务精修合同](forge-finance-page-polish-contract-20260915.md)、[确认与发票合同](forge-finance-confirmation-invoice-contract-20260915.md) |
| 供应链逐页交付 | [供应链页面设计清单](forge-supply-chain-page-design-inventory-20260915.md)、[采购申请合同](forge-purchase-request-page-contract-20260916.md)、[采购待办池](forge-purchase-todo-pool-page-contract-20260915.md)、[询价](forge-purchase-inquiry-page-contract-20260916.md)、[供应商价格本](forge-supplier-price-book-page-contract-20260916.md) |
| 其他业务域 | [RISEMAP 功能域目录](risemap/README.md)，再按域定位对应 Forge 页面合同；不能把目录存在计为功能完成 |

## 规范与原始材料

- [完整复刻与采集标准](risemap-replication-spec.md)、[跨模块业务旅程](risemap/journeys.md)。
- [三类业务定义](business-model.md)、[客户会议纪要提炼](customer-meeting-20260907-findings.md)、[正式版本要求](first-release.md)。
- [references](references/)：原始截图、DOM、采集步骤及来源；[evidence](evidence/)：验收图像等证据；[standard-test-data](standard-test-data/)：对照材料。均按需读取，不因体积或数量批量删除。
- 正式要求、页面合同和验收证据继续保留原路径。日期较早不自动意味着失效，证据需与对应实现版本一起判断。

## 历史与归档

- [归档清单与恢复说明](archive/README.md)：早期选型、首版建议和原项目首页。
- [2026-09-12 验收矩阵](forge-verification-matrix.md)、[早期滚动交接记录](risemap-rolling-handoff.md)：保留当时材料和结果，不再宣称当前状态唯一权威。
- [页面产品化阶段方案](forge-productization-plan.md)、[产品恢复方案](risemap-product-recovery-plan.md)、[结构恢复方案](risemap-product-structure-recovery-plan.md)：原位标记为历史，保留被引用路径；现行取证和执行规则遵循主仓 AGENTS.md。

## 维护方式

新合同和报告写明范围、代码版本、环境、材料、实际验证与缺口；尽量更新对应业务文档，不新建互相竞争的“唯一当前状态”。归档前核对入链和出链，保存迁移关系，修复链接；不为了清理目录重写历史办理结果。
