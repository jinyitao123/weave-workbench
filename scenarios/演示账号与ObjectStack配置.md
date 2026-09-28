# OTC 演示账号与 ObjectStack 配置主册

适用：124 开发联调环境；更新：2026-09-28。本文件是合同、线索、报价以及后续销售到项目/OTC 场景共用的**Git 版本管理演示账号主册**。仅在当前私有仓库跟踪；本机文件权限为 0600，Git 不保存这一读写权限，新机器检出后应重新设为 0600。不在其他文档、命令输出或聊天中重复密码。账号在 124 创建或改密后应更新本主册并提交；**“已创建”与“本人页面办理通过”仍是两项不同证据**。

## 一、账号与密码

已有五个账号沿用原口令，本轮没有重置。另十五个账号已通过 124 的 ObjectStack 管理员账号接口创建，密码按本主册设置；其中六个已单独登录实测，其余账号已存在但待逐一登录验收。

| 测试身份 | Forge 登录邮箱 | 本机测试密码 | 124 状态 |
| --- | --- | --- | --- |
| 系统管理员 | `admin@inoforge.local` | `Gf!wj25ln9iu9nuiai8cr23ukvz9A` | 124 已存在；沿用本机原密码，未在本轮重置 |
| 销售小王 | `sales.wang@inoforge.local` | `!jL_@sf#Pk5EemUFmd5W` | 124 已存在；沿用本机原密码，未在本轮重置 |
| 交付负责人小李 | `delivery.li@inoforge.local` | `#Ir7yWhBhEbRx@hnzB0k` | 124 已存在；沿用本机原密码，未在本轮重置 |
| 商务财务小陈 | `business.chen@inoforge.local` | `HCmcY7zNohdHDA4_54G_` | 124 已存在；沿用本机原密码，未在本轮重置 |
| 团队开发者小周 | `developer.zhou@inoforge.local` | `7654321@` | 124 已存在；沿用本机原密码，未在本轮重置 |
| 解决方案小孙 | `solution.sun@inoforge.local` | `gu!edHUY6wji+77A8WEmBD4%J2` | 124 已创建、密码已设置；登录已实测 |
| PMO小刘 | `pmo.liu@inoforge.local` | `b@ub9w4CW9GMU@7QvX9e#iCdC7` | 124 已创建、密码已设置；登录已实测 |
| 报价复核小赵 | `pricing.zhao@inoforge.local` | `D5QQ@j-2+Qtb3ytLxqitDo#fB7` | 124 已创建、密码已设置；登录已实测 |
| 法务小何 | `legal.he@inoforge.local` | `j4n52biSRsE@pdhHCLSGjkHT!8` | 124 已创建、密码已设置；登录已实测 |
| 合同签署归档小胡 | `signature.hu@inoforge.local` | `T3z#+4r!r37jgRYiVunDHxqsvU` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 订单复核小吴 | `order.wu@inoforge.local` | `5wdHTbsUF4a#G%mpJwXsZV4mtC` | 124 已创建、密码已设置；登录已实测 |
| 物料资料小高 | `material.gao@inoforge.local` | `HSkBb4DaLE6m2-tj7dmY+oaJ+y` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 采购经办小张 | `procurement.zhang@inoforge.local` | `oVR#8HdYhUPG3rD_titS@36RZw` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 生产经办小黄 | `production.huang@inoforge.local` | `93e-xJ+3@rj4J+qN9FMfZ%xLkX` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 仓库发货小马 | `warehouse.ma@inoforge.local` | `NWwn@!LysnRk6zHt-3x9%3-j6C` | 124 已创建、密码已设置；登录已实测 |
| 质检小罗 | `quality.luo@inoforge.local` | `!atGCE4!_5qEY@NeAMJEap-L89` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 现场交付小徐 | `field.xu@inoforge.local` | `9igBdp4MPX-GhCDUpEwrZ!kEaT` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 应收回款小林 | `finance.lin@inoforge.local` | `zhM7mJceoZddTB+zeBzFS5Q5Xt` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 财务复核小唐 | `finance.review.tang@inoforge.local` | `jL7DWQZ2yFdW_bPhPDJ9nM@DNW` | 124 已创建、密码已设置；尚待逐一登录验收 |
| 售后小钱 | `service.qian@inoforge.local` | `u8@!K+YAuJ42ggt35rRF@yxb2Y` | 124 已创建、密码已设置；尚待逐一登录验收 |

本场景**不使用**遗留的 `auditor@inoforge.local`“独立核验员”账号。124 目前仍存在该账号及 `viewer_readonly` 通配读取权限集；它不是 OTC 业务岗位。先按现有业务参与人做独立读回，另行审查该账号后再决定是否停用或收窄，不在本轮擅自删除。

## 二、ObjectStack 里分别配置什么

把账号看成“人”，岗位看成“收件牌”，权限集看成“钥匙”，记录范围看成“钥匙可开的具体柜子”。岗位负责找到下一位员工，权限集负责准许其操作；员工有钥匙也仍须满足单据状态、来源和版本校验。

- **组织：** 沿用 124 现有 `Default Organization`；不另建一套测试组织。2026-09-28 配置读回为一个组织及八个业务单元。
- **目标业务单元：** `销售与客户`、`解决方案`、`商务与法务`、`PMO`、`项目与交付`、`供应链与制造`、`财务`、`平台开发`。这八个业务单元已在 124 的 ObjectStack 原生数据接口创建并读回。各账号对应业务单元见下表；跨单位办理必须再受具体记录/项目授权约束。
- **平台身份：** 普通测试员工为组织成员；管理员是组织 owner 且直接拥有 `admin_full_access`。所有测试用户在 `sys_user.role` 的表面值均为 `user`，这个字符串本身不能代表业务权限。
- **原生关系：** `sys_user` 是账号，`sys_member` 是组织成员，`sys_business_unit` 是业务单元，`sys_position` 是岗位，`sys_user_position` 是某员工何时在哪个单位任职，`sys_permission_set` 是权限集；`sys_position_permission_set` 把岗位与钥匙相连，`sys_user_permission_set` 仅用于有理由、期限和审计的个人例外。
- **当前缺口：** 124 原先只有 `everyone → member_default`；本轮又为八类现有业务岗位建立了十六条岗位—权限集关系，报价审批、订单审批、订单经办、合同两岗、仓库发货、销售负责人及项目经理已有对应钥匙。小王/小李/小陈原有的账号直授仍保留，避免本轮联调中途撤权；确认岗位继承和本人业务页后再有序撤回重复直授。其余十三个目标权限集尚未注册，不能仅凭岗位名宣称可办理。不要给通用 `user` 或 `everyone` 加业务写入权限。
- **记录与字段：** “能看项目”还须限定为本人拥有、自己负责或本项目获准成员；报价成本/毛利按职责另控；不能因为岗位存在就看到全组织合同、文件或财务数据。Forge 领域动作再次检查当前员工、准确业务对象、版本与状态。Weave 和桌面 Pi 只借员工本次获准的钥匙，不另建员工账号或复制管理员凭据。

## 三、已有账号的目标职责

| 员工 | 目标业务单元 | 岗位/接力方式 | 所需权限集与边界 |
| --- | --- | --- | --- |
| 系统管理员 | 平台 | 不担任业务审批 | 平台全权限；销售/供应链设置维护 |
| 销售小王 | 销售与客户 | 销售负责人 | 线索/商机、本人报价草稿与调价、本人合同、售前项目 |
| 交付负责人小李 | 项目与交付 | 合同交付复核岗；项目经理 | 分配合同复核；本人项目计划、团队与交接 |
| 商务财务小陈 | 商务与法务 | 合同商务复核岗；销售订单经办岗 | 分配合同复核；本人销售订单经办 |
| 团队开发者小周 | 平台开发 | 团队开发者（非业务审批岗） | Weave团队开发；不继承Forge销售资料权限 |

- 小王已任 `sales_owner`，绑定现有的线索、报价、合同和售前项目所需权限集；业务记录仍按实际负责人/所有者收窄，不因为任职而看全组织记录。
- 小李已任 `contract_delivery_reviewer` 及新增的 `project_manager`；两岗分别绑定 `sales_contract_reviewer` 和项目办理/经理权限集。项目可见范围仍按记录的 `manager_id` 收窄。
- 小陈已任 `contract_commercial_reviewer` 和 `sales_order_operator`，两岗已分别绑定 `sales_contract_reviewer` 与 `sales_order_operator`。**订单经办人不得审批自己创建的订单**。
- 小周的 `weave_team_developer` 是开发入口的个人授权，没有 Forge 销售记录权限；如需团队开发岗位可单设，但不能由它自动取得销售数据。
- 管理员只负责平台配置/测试环境维护，不作为报价、合同或订单的业务复核人。
- 权限现状只说明“已配置”，不等于所有正常页面、RLS、文件、审批或下一员工接力均已验收。调整任职后要让实际员工重新登录读回。

## 四、需新增的测试员工、岗位与权限

下表十五个新增账号及其业务单元、岗位任职已在 124 创建和读回。报价复核、订单复核、仓库发货三类对应权限集已在现行 Forge 注册并绑定岗位，三名新员工已登录读回对应系统权限；其余十三个目标权限集**尚未在现行 Forge 注册**，这些岗位暂不具备其描述的业务办理能力。岗位不能凭名称猜出能力，也不能用通用管理员权限补位。

| 员工 | 目标业务单元 | ObjectStack 岗位代码 | 权限集（目标） | 准许的业务边界 | OTC 阶段 |
| --- | --- | --- | --- | --- | --- |
| 解决方案小孙 | 解决方案 | `solution_owner` | `forge_solution_operator` | 需求调研、技术方案、SOW与被分配项目的技术材料 | P1–P3 |
| PMO小刘 | PMO | `pmo_gate_reviewer` | `forge_project_gate_reviewer` | KP1/KP2等阶段材料检查及结论，不代项目经理执行 | P1/P4 |
| 报价复核小赵 | 商务与法务 | `sales_quotation_reviewer` | `sales_quotation_reviewer` | 冻结版报价审批；成本/毛利查看须单独按规则开放 | P2 |
| 法务小何 | 商务与法务 | `contract_legal_reviewer` | `sales_contract_legal_reviewer` | 仅非标合同法律条款复核与意见 | P3可选 |
| 合同签署归档小胡 | 商务与法务 | `contract_signature_registrar` | `contract_signature_registrar` | 已通过合同的签署版登记、回传与归档；不得代审批 | P3 |
| 订单复核小吴 | 商务与法务 | `sales_order_reviewer` | `sales_order_reviewer` | 独立复核订单来源、数量、金额和下单条件；不得审批自己创建的单据 | P3 |
| 物料资料小高 | 供应链与制造 | `material_master_operator` | `forge_material_master_operator` | 维护物料、SKU、单位及客户物料映射，不批准订单 | P3/P5 |
| 采购经办小张 | 供应链与制造 | `procurement_operator` | `forge_procurement_operator` | 从已确认缺料/计划办理采购订单与到货跟进 | P5 |
| 生产经办小黄 | 供应链与制造 | `production_operator` | `forge_production_operator` | 按有效订单/BOM办理生产计划、领料和完工 | P5–P6 |
| 仓库发货小马 | 供应链与制造 | `warehouse_fulfillment_operator` | `sales_order_fulfillment_operator；forge_warehouse_operator` | 仅对物料行办理发货、出入库；服务行不动库存 | P6 |
| 质检小罗 | 供应链与制造 | `quality_inspector` | `forge_quality_inspector` | 到货、生产与交付质量检查及结果记录 | P5–P6 |
| 现场交付小徐 | 项目与交付 | `delivery_executor` | `forge_delivery_operator` | 按分配项目办理施工、调试、交付包和整改事项 | P6–P7 |
| 应收回款小林 | 财务 | `finance_receivables_operator` | `forge_finance_receivables_operator` | 按获准合同/订单办理发票、应收和收款登记 | P7 |
| 财务复核小唐 | 财务 | `finance_reviewer` | `forge_finance_reviewer` | 独立复核收款分配、核销与财务例外；不自审 | P7 |
| 售后小钱 | 项目与交付 | `after_sales_operator` | `forge_service_operator` | 按质保范围接续售后工单和服务结果 | P7后 |

**职责冲突规则：** 销售小王可起草但不自批报价或合同；报价复核小赵不修改报价明细；订单经办小陈不担任同单订单审批；财务登记小林不自批核销。法务岗只在非标条款确需复核时加入，不使标准合同平白多一关。岗位任职可设有效期，离岗后旧待办须由 Forge 按原生审批/分配规则明确转交。

## 五、先落地的最短业务接力

1. 小王办理本人线索、商机与两行报价；方案小孙只补获准需求/SOW，不触碰客户正式成交状态。
2. 124 已建立 `sales_quotation_reviewer` 岗、小赵任职与同名权限集绑定；小赵登录可读回该系统权限。原生审批中心对冻结版报价的真实办理仍待同一测试单据实测。若审批必须判断毛利，先确定审批口径并对小赵单独开放必要成本字段；销售仍不可见。
3. 客户发送、接受使用带准确报价版本的联调模拟凭证通过正常业务动作登记，清楚标为测试，不写成真实客户承诺。
4. 小王准备合同；小李审交付，小陈审商务，非标时小何审法务。内部审批通过后，应由签署归档小胡登记真实业务或标明联调模拟的签署材料。**当前 `contract_register_signature` 只要求 `sales_contract_operator`，仍会让销售办理签署登记；目标需先拆出签署登记权限，再把动作授给正确岗位。**
5. 小陈凭已签署、符合下单条件的合同建立本人订单；订单复核小吴的 `sales_order_reviewer` 岗位任职和权限集绑定已完成，登录可读回系统权限；真实订单审批仍待有正式订单时实测。
6. 小李在已有项目关联同客户有效合同/订单，读回设备与服务两类交付范围。预计营收是售前预测，合同/订单金额是正式来源；物料行走发货库存，服务行进入项目执行。
7. 后续采购、生产、仓库、质检、现场交付、验收、开票应收、收款和售后再按上表启用相应岗位与窄权限，不因账号预建而自动开放所有业务域。

## 六、124 配置结果与后续验收

1. 现有组织内的八个业务单元、十五个新增账号、十七个新增岗位及全部二十个测试账号的业务单元成员关系已配置。新密码已通过 ObjectStack 原生管理员创建账号接口提交到 124；第一节明确区分六个已登录实测和九个待逐一登录验收。
2. 现行 Forge 已注册的权限集通过原生 `sys_position_permission_set` 绑定到八类业务岗位，十七个新增任职及三个原有任职均已落到对应业务单元；本轮未设置过期日期。尚缺的十三个目标权限集需先由对应业务域提供，再按最小范围绑定；业务对象上仍须填写负责人/项目经理。
3. 审批流以岗位代码找当前有效任职，消息/事项归员工账号。多人按既定会签，岗位无人时停在明确待分配状态，不让模型猜人，也不改成管理员代办。正式动作仍检查单据状态、材料版本及记录范围。
4. 每个岗位用本人账号走“收到事项→打开本人的正确记录/材料→办理→下一人收到→Forge 页面重开读回”；再用无关账号确认拒绝。切换账号后桌面 Pi 重新读取本人的权限、材料与待办。不能用菜单可见、健康检查或管理员查询代替验收。
5. 先验证报价复核、合同两岗、签署登记、订单经办/独立审批、项目经理这段；后续岗位随着 OTC 阶段启用。任何缺对象/动作/权限集的目标能力在代码里补领域扩展，优先 ObjectStack 原生能力，不改 ObjectStack 核心，不给通用写表权限。

**本轮原生读回计数：** 组织 1、业务单元 8、组织成员 21（含未使用的遗留核验员）、业务单元成员 20、岗位 26（含系统岗位）、有效测试任职 20、岗位—权限集关系 17（含默认 everyone 关系），原有个人权限集直授 19 条尚未撤回。上述计数只证明配置保存；报价审批、订单审批、合同签署登记、项目接力以及下游业务页面仍需按岗位分别实走。

## 七、当前权限边界仍需验证

- 报价复核岗、小吴订单复核岗和小马仓库发货岗已通过各自新账号登录及 `/auth/me/permissions` 读回系统权限；这尚未证明某张实际报价、订单或库存记录的可见/可办理范围。
- 现行 `sales_quotation_reviewer` 和 `sales_order_reviewer` 定义使用组织范围读取；审批应以分配给本人的冻结版本为办理依据，仍需用无关报价和草稿检验记录边界。报价复核岗当前还屏蔽成本字段；若客户要求按毛利审批，先明确责任和补最小字段授权，不把未知成本猜成已通过。
- 小胡等十三类后续岗位只有账号、业务单元和有效任职，目标权限集仍未注册，**不能因账号能登录就宣称可办理该业务**。订单经办与订单复核、财务登记与财务复核仍分人；小陈原个人直授暂留，待岗位继承的真实页面链验收后再考虑收回。
- 合同签署登记动作当前仍用 `sales_contract_operator`，与目标商务签署岗不一致；此项需 Forge 领域动作最小调整后再让小胡办理。遗留核验员账号和 `viewer_readonly` 仍存在，未用于本测试，也未在本轮改变。
