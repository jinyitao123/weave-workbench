# 华炎魔方与现成业务系统核查

> 历史归档：2026-09-08 的选型或范围建议，不再作为当前技术选型、实施队列或验收状态。当前入口见[文档索引](../../README.md)。正文保留当时判断。

**当前交付前提**　Forge 首版供真实客户购买和持续使用。框架试验与厂商演示只提供选型证据，正式交付须满足[首版交付要求](../../first-release.md)。本文件中的源码事实沿用核查快照，未因此新增运行通过结论。

核查于 2026-09-08。发起人补充记得系统叫“华炎魔方”。根据该线索，已找到匹配度较高的官方方案，并核对公开应用源码。本轮没有获得厂商演示环境、完整商业交付包或用户真实单据，没有安装运行应用。

## 最接近一弓描述的对象

优先候选是[华炎魔方工程项目管理解决方案](https://www.steedos.com/resources/solutions/construction)。官方页面将商机、项目、合同、采购、费用与收付款放在同一经营流程中，并按销售、项目、采购、财务等角色描述工作。其[官方视频目录](https://docs.steedos.com/zh-CN/videos/)还列有项目解决方案分享会。

这足以确认存在一套接近我们目标的方案展示。结合用户回忆，它很可能是一弓所指的对象，但具体版本及交付包尚未确认。公开材料也不足以证实其销售情况，不能称为已核验的畅销产品。

对 Forge 最有参考价值的是销售承诺如何交给项目，以及项目怎样关联合同和资金。官方方案以项目为中心，而 Forge 还需要一次产品的独立销售订单路径；工程验收也要逐项留证，不能只设置“已验收”状态。

## 华炎魔方与 ObjectStack 的关系

Steedos 平台官方仓库声明正在向 ObjectStack 演进，同时继续支持 v2.x。公开项目与合同应用仍能看到旧版运行时依赖及 YAML 元数据，HotCRM 则已经采用 ObjectStack 17 系列。应按具体应用包及其运行时判断兼容性。[Steedos 迁移声明](https://github.com/steedos/steedos-platform/blob/761e37c974d9bedf7f99d27d1b967eef0f53ff97/README.md)

| 对象 | 当前可确认的关系 | 对采用的影响 |
| --- | --- | --- |
| 华炎魔方工程项目方案 | 基于 Steedos 展示项目与经营管理流程 | 适合业务对照，需演示环境证明具体交付能力 |
| Steedos 旧版项目、合同应用 | 声明 Steedos 1.x 或 2.x 系列依赖 | 不能当作 ObjectStack 17 原生包直接安排安装 |
| ObjectStack | 新的开源应用框架与运行基础 | 需要编写 Forge 业务定义并验证固定版本 |
| HotCRM、HotCLM | 基于 ObjectStack 的公开应用 | 可复用部分业务模式，未覆盖 Forge 从报价到验收的完整流程 |
| ObjectOS | 基于 ObjectStack 的商业产品 | 产品内 AI 及部分能力应按实际版本另查 |

因此，现有证据支持“同一技术生态正在演进”，尚不支持“整套工程方案已迁移到当前 ObjectStack，下载后即可使用”。新旧仓库中的名称和架构表述也有历史差异，不能仅凭 README 的总述推定应用运行版本。

## 开源与试用入口

同日补充核查，Steedos 平台仓库公开，默认分支为 `3.0`，根目录 `LICENSE.txt` 为 AGPL-3.0。当前官方版本对比页也将社区版列为免费、采用 AGPL 3.0；旧版 2.7 文档中的 MIT 表述不能直接用于当前版本。[平台许可文件](https://github.com/steedos/steedos-platform/blob/3.0/LICENSE.txt)、[官方版本对比](https://www.steedos.cn/platform/pricing)

项目与合同有公开应用仓库，范围见下表。完整工程项目解决方案是否以同一公开包交付，尚未确认。平台公开和应用公开分别核查，不能把平台仓库当作完整业务方案的源码证明。

体验有两条已找到的路径。社区版有官方自部署说明，可以建立自己的体验环境；官网提供扫码预约产品演示和商务咨询。当前未确认可直接注册并操作完整工程项目方案的公开试用入口，也未获得试用账号。[社区版入门](https://docs.steedos.com/zh-CN/getting-started/)、[官网预约入口](https://www.steedos.com/)

官网商务咨询跳转飞书表单，本轮访问要求登录。未提交表单或联系厂商。若以业务复刻为目的，优先申请完整工程方案的可操作试用环境，才能核对合同、项目、变更与验收的真实办理；仅运行空白平台无法完成这项对照。

## 公开应用到底包含什么

下表中的对象存在和依赖版本来自固定提交。没有运行验证的功能均按源码可见范围表述。

| 候选 | 已核查的内容 | 与 Forge 的距离 |
| --- | --- | --- |
| 华炎魔方工程项目方案 | 官方展示销售、合同、项目、采购、财务、费控及相互关联 | 业务参考最接近，仍缺具体包、运行版本、报价版本与验收办理的实操证据 |
| `steedos-labs/project` | 包 `@steedos-labs/project-ce` 为 `2.2.6`；宿主依赖 Steedos `^2.5`；有项目、任务、里程碑、工时、费用、问题等对象 | 可研究项目模型；未在该仓库对象清单中找到完整报价与工程验收明细模型 |
| `steedos/contract` | 包 `@steedos-labs/contract-ce` 为 `0.0.4`；宿主依赖包加载器 `^2.6`；有合同、收付款计划、收付款记录及项目 | 已看到合同到项目的真实关联，仍不能证明完整交付、制造或整改流程 |
| `steedos/project-management-app` | 较早应用包 `1.23.40`，依赖同系列 `steedos-server` | 保留为历史参考，避免与新项目包混装 |
| `steedos/steedos-app-sales` | CRM 应用包 `1.2.0`，依赖 `steedos-server ^1.21.6` 和基础客户包 | 可参考销售定义，部分对象由依赖提供；未证明与上述项目包已完成统一运行 |
| HotCRM | 应用包 `3.0.0`，固定 ObjectStack `17.3.0`；含客户、商机、产品、报价、报价明细、合同等 | 新框架下最适合参考前端销售；所查对象清单没有 Forge 的销售订单、工程项目、配置版本和验收对象 |
| HotCLM | 应用包 `0.1.0`，声明 ObjectStack `^17.0.0`；有合同、审查、签署、履约及付款计划相关定义与流程 | 合同专项参考；不能替代订单、制造与项目交付 |
| ObjectStack 项目与采购模板 | 项目含里程碑、风险、资源、工时等；采购含供应商、请购、订单与收货 | 是局部起点，跨应用业务交接和 Forge 特有规则需补建 |

固定源码见[Steedos 项目](https://github.com/steedos-labs/project/tree/cd765e166121f68d6b722de1fae3ca8ed4b404c2)、[Steedos 合同](https://github.com/steedos/contract/tree/06fad7ce6ae28b41bb6f70bfcbcabddef87a2dfb)、[早期项目应用](https://github.com/steedos/project-management-app/tree/fdc4dbc0ccaf0d6e273c65188df413de3da89db2)、[早期 CRM](https://github.com/steedos/steedos-app-sales/tree/31bfdaf06e6ffed55ad9450cef5715a343438fb2)、[HotCRM](https://github.com/objectstack-ai/hotcrm/tree/5b2ecdd24dc1417400e6b35004e607fbaef8ab72)、[HotCLM](https://github.com/objectstack-ai/hotclm/tree/c1ae9acd6d7b64ddf260e268f8975c019f528c3d)、[模板集合](https://github.com/objectstack-ai/templates/tree/960f24db4fa4f3551d7089cfc1f03938eccae75e)。

## 四处值得特别核对

Steedos 合同包的 `contracts.project` 确实引用 `project`，声明为主从关系。这说明合同和项目间存在业务连接。同时，项目包和合同包都定义了名为 `project` 的对象，合并使用时需要检查对象定义如何组合及字段是否冲突，不能简单拷贝两套目录。[合同关联字段](https://github.com/steedos/contract/blob/06fad7ce6ae28b41bb6f70bfcbcabddef87a2dfb/steedos-packages/contract/main/default/objects/contracts/fields/project.field.yml)

项目包的状态字段确实包含 `accepted`，显示为“已验收”。它是一个状态选项；仅凭这个字段无法证明有验收标准、调试依据、整改复验和客户确认的完整流程。该对象还启用了附件及工作流，实际流程可能由配置或商业包补充，需在演示中核实。[项目状态](https://github.com/steedos-labs/project/blob/cd765e166121f68d6b722de1fae3ca8ed4b404c2/steedos-packages/project/main/default/objects/project/fields/status.field.yml)

ObjectStack 的项目模板明确把真实模型接入列为后续工作，风险评估 Flow 调用名为 `pm.aiRiskAssessmentStub` 的占位函数。采购模板的订单行暂存在 JSON 中，逐行收货及发票处理需要扩展。把它们纳入 Forge 时，应按实际代码范围估算，不能从“AI 项目管理”或“采购系统”的名称推算成熟度。[项目范围](https://github.com/objectstack-ai/templates/blob/960f24db4fa4f3551d7089cfc1f03938eccae75e/packages/project/CHARTER.md)、[预测流程](https://github.com/objectstack-ai/templates/blob/960f24db4fa4f3551d7089cfc1f03938eccae75e/packages/project/src/flows/daily_ai_risk_assessment.flow.ts)、[采购范围](https://github.com/objectstack-ai/templates/blob/960f24db4fa4f3551d7089cfc1f03938eccae75e/packages/procurement/CHARTER.md)

模板集合的 `all` 包将多套应用编译到同一运行环境，但各自保留命名空间和演示数据；统一入口不能证明统一业务交接。HotCLM 的演示说明也明确，部分演示合同虽然有审批状态，却没有真实审批请求，因为种子加载抑制了自动化。演示数据数量不能用来判断流程是否走通。[模板聚合方式](https://github.com/objectstack-ai/templates/blob/960f24db4fa4f3551d7089cfc1f03938eccae75e/packages/all/README.md)、[HotCLM 演示边界](https://github.com/objectstack-ai/hotclm/blob/c1ae9acd6d7b64ddf260e268f8975c019f528c3d/README.md)

## 与 Forge 的业务对照

| Forge 需要处理的任务 | 可以借鉴的现有部分 | 仍需证明或补建 |
| --- | --- | --- |
| 需求与报价 | HotCRM 的客户、商机、报价和明细 | 原始材料依据、报价版本固定、客户确认与内部审核分开 |
| 合同与订单转换 | Steedos 的合同项目关系，HotCRM 的成交后处理 | 交付路径选择、输入版本快照、重复请求和失败续办 |
| 一次产品 | CRM 产品与报价模型 | 独立销售订单、采购制造状态及发运签收，不强制立项 |
| 一次柜机 | 项目、任务、里程碑、问题管理 | 配置与设计版本、集成调试、移交验收和整改复验 |
| 二次项目 | 工程项目方案的项目组织与经营视图 | 一次制造、二次采购制造、现场调试与验收移交的区别 |
| 配置及变更 | 官方方案中的变更管理思路 | 变更前后范围、价格、交期、设计版本与客户确认的关联 |
| 验收 | 项目状态、附件、问题和工作流基础 | 验收项、证据、未通过项、整改与复验、最终确认的完整办理 |
| AI | 框架接入机制及局部模板声明 | 需求整理与验收草稿的真实模型接入、引用复核和效果评估 |

官方[项目管理方案](https://www.steedos.com/resources/solutions/project)描述了需求、变更和交付文档管理，适合进一步观察其操作方式。该页面的方案描述尚不能替代具体交付包或实操证据。

## 三种采用方式怎样选

| 路径 | 对三到四周首版的价值 | 采用条件 |
| --- | --- | --- |
| 获取厂商现成工程方案后配置 | 若业务与运行交付能力已具备，可能减少首版开发工作 | 取得明确版本及环境，业务流程与正式运行验证通过，确认客户开通、维护和扩展条件 |
| 固定 ObjectStack 版本开发小型 Forge | 易于围绕我们的三类交付定义形成一致模型 | 两天初筛通过，完成正式交付验证，业务人员持续提供材料与核对 |
| 拼接旧 Steedos 包并迁移到新框架 | 可以继承一些对象定义 | 需同时解决运行时、元数据、业务与界面差异；当前证据下不适合首期 |

当前建议将华炎魔方工程方案作为优先业务对照，同时保留 ObjectStack 的有限技术试验。两者分别回答“业务应怎样办理”和“我们能否在目标周期做出来”。没有现成可运行包之前，不把旧应用迁移列入首期计划。

公开项目包同时出现不同措辞的许可文件，包清单又标记 MIT。正式复制或分发前需要按实际选用的包和文件确认适用条款；本轮没有作出整套方案可自由分发的结论。[项目包清单](https://github.com/steedos-labs/project/blob/cd765e166121f68d6b722de1fae3ca8ed4b404c2/steedos-packages/project/package.json)、[LICENSE.md](https://github.com/steedos-labs/project/blob/cd765e166121f68d6b722de1fae3ca8ed4b404c2/steedos-packages/project/LICENSE.md)、[LICENSE.txt](https://github.com/steedos-labs/project/blob/cd765e166121f68d6b722de1fae3ca8ed4b404c2/steedos-packages/project/LICENSE.txt)

## 下一次演示应看什么

可以用同一份柜机历史项目材料，让现成方案依次完成下列操作，再与 Forge 技术试验对照。

1. 建立有两次修订的报价，完成内部审核并保存客户确认依据。
2. 根据合同与订单信息建立柜机项目，重复执行交接，检查是否重复立项。
3. 登记配置或设计版本、一次范围变更及价格和交期影响。
4. 登记调试与交付材料，让一项验收不通过，再办理整改和复验。
5. 查看最终确认能否追溯报价、变更和证据，并导出所需材料。
6. 换用销售与项目负责人身份操作，再补一个无需立项的产品签收案例。

演示前所需信息已收窄为具体方案或包名、运行版本、演示入口及可交付范围。方案全景和任务清单已经可供一弓核对；尚未向厂商发消息或预约演示。

所有源码快照及抽查文件散列见[来源清单](../../references/framework-source-snapshots.json)。本轮完成资料与源码层的候选核查，运行兼容性、真实业务闭环和客户价值仍待验证。
