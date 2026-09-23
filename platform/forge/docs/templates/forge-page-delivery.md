# 逐页交付合同与验收记录模板

2026-09-23 起按 Forge 业务目标验收，外部产品仅作参考。占位内容不构成证据。结构化记录使用 schemaVersion 3；schemaVersion 1/2 继续按旧规则解释历史记录，见[交付标准](../forge-page-delivery-standard.md)。

## 批次和范围

- 功能编号 / 所属应用及包 / 业务链 / 维护负责人 / 独立复核者：
- 起始提交 / 分支 / 工作树 / FORGE_URL / 持久数据库类型与标识：
- 范围来源：岗位任务、导航、页面、内部跳转、Action、设置及结果使用者。
- 本批要求、前置条件、依赖应用、排除项与依据、下一步：
- 当前分类：需求待明确 / 未实现 / 入口缺失 / 流程断开 / 数据权限错误 / 仅缺证据。

## 交付目标设计

- surfaceType（object/dashboard/report/component/action/page）/ 目标对象、视图或定义 / pageId（仅自定义 Page 必填）/ 应用及新入口 / 新通知与详情链接：
- 岗位 / 主任务 / 主单据 / 正式来源 / 下一岗位及结果：
- 需求来源：用户目标 / 客户规则 / Forge 决策 / 可选外部参考（日期、采用内容及限制）：
- 主原型 / Forge 设计基线版本、截图与材料 / 首屏顺序 / 主操作：
- 字段、筛选、分页、金额/数量口径、状态、阻断、异常和恢复：
- 依赖设置：维护方、组织范围、权限、生效版本、实际消费者与在途业务：
- 桌面/侧栏展开/窄屏、有数据/空态/错误/受限/提交中/弹窗；长文本与最多动作的几何检查：
- 性能：冷打开、刷新、切页、关键请求数、体积、重复读取及重挂载：

| 要求编号 | 来源与明确决定 | 区域/控件及实现 | 操作步骤 | 预期结果 | 实际结果与证据 | 状态/缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-001 | 待填写 | | | | | pending |

不以隐藏控件删除已采用要求。只读或无表单功能可说明具体不适用项，需提供职责依据并经复核。

## 验收与交接

- requirements / visual / interaction / business / permissions / persistence / performance 分别记录结果。
- 正常路径、关键异常、角色、独立回读、API 辅助、同一持久数据库重启、工程检查：
- 业务设置修改保存、独立/重启读回、实际生效、无权拒绝与旧单版本：
- 独立复核者、日期、复现和退回缺陷；未发生如实写待复核。
- 已证明、未证明、复用证据与理由、阻塞和下一动作；耗时/费用无可靠来源写未知。

## 结构化记录 schemaVersion 3

先在 manifest 中声明 `featureId`、`app`、`surfaceType`、`target`、完整 `requirementIds` 和 `subjectFiles` 路径，再在验收记录中为这些实际文件填写 SHA-256。accepted 时文件路径集合与要求编号集合都必须完全一致；从验收记录删去困难要求不能通过。surfaceType 支持 object、dashboard、report、component、action 和 page；只有自定义 Page 才填写 `pageId`，且等于 `target`。无需为原生表面虚构 React 文件。

manifest 条目示例：

```json
{
  "featureId": "supply-chain.goods-receipt-post",
  "app": "supply-chain",
  "surfaceType": "action",
  "target": "goods_receipt.post",
  "subjectFiles": ["apps/forge-objectstack/src/actions/goods-receipt.action.ts"],
  "requirementIds": ["REQ-001"],
  "designStatus": "review_required",
  "acceptance": "apps/forge-objectstack/tests/acceptance/goods-receipt-post.json"
}
```

以下是待验收草稿结构。review_required 可保留 pending 状态；它不代表机器 accepted。提交时必须把缺失字段替换成实际材料、操作者、文件摘要和证据。

```json
{
  "schemaVersion": 3,
  "featureId": "supply-chain.goods-receipt-post",
  "app": "supply-chain",
  "surfaceType": "action",
  "target": "goods_receipt.post",
  "reviewedRevision": "",
  "subjectFiles": {},
  "environment": {
    "forgeUrl": "http://127.0.0.1:4611",
    "databaseType": "sqlite",
    "database": ".objectstack/gate-v3.sqlite",
    "materials": [{ "id": "CASE-001", "name": "实际验收材料名称" }]
  },
  "designBaseline": { "revision": "Forge 基线标识", "evidence": [] },
  "referenceEvidence": [],
  "checks": {
    "requirements": { "status": "pending", "evidence": [] },
    "visual": { "status": "pending", "evidence": [] },
    "interaction": { "status": "pending", "evidence": [] },
    "business": { "status": "pending", "evidence": [] },
    "permissions": { "status": "pending", "evidence": [], "roles": [] },
    "persistence": { "status": "pending", "scope": "required", "evidence": [] },
    "performance": { "status": "pending", "evidence": [], "metrics": [] }
  },
  "requirements": [{
    "id": "REQ-001",
    "source": { "type": "forge_decision", "reference": "对应业务合同或决定" },
    "statement": "待填写已采纳的业务要求",
    "subjectFiles": [],
    "steps": [],
    "expected": "",
    "actual": "",
    "stateEffect": "writes_business_state",
    "status": "pending",
    "evidence": []
  }],
  "settingsConsumers": [],
  "review": { "implementer": "实施者账号", "reviewer": "独立复核者账号", "status": "pending", "evidence": [] }
}
```

每个 evidence 项必须指向仓库内真实、非空且已脱敏的文件，并绑定版本、feature、target、材料和操作者。PNG 证据须可解码，尺寸必须与记录视口相同；JSON 证据内容也须重复绑定 featureId、target、materialId、revision 和 actor。字段形状如下；视觉证据另带 `viewport`，持久化证据另带 `databaseType`、`database`，独立复核证据另带 `decision`。

```json
{
  "path": "docs/evidence/CASE-001-desktop.png",
  "kind": "forge_screenshot",
  "claim": "Forge 桌面视口中目标表面可读且无裁切",
  "method": "browser_capture",
  "actor": "实际操作者账号",
  "role": "warehouse_operator",
  "materialId": "CASE-001",
  "capturedAt": "2026-09-23T11:00:00+08:00",
  "revision": "验收提交的 40 位 SHA",
  "featureId": "supply-chain.goods-receipt-post",
  "target": "goods_receipt.post",
  "viewport": { "class": "desktop", "width": 1440, "height": 900 }
}
```

accepted 记录必须满足以下要求：

- 七个维度全部为 pass，并各有结论和结构化证据；requirements 对每项要求分别绑定来源、步骤、预期/实际结果、状态、实现文件和证据。
- visual 同时有 Forge 桌面截图（宽度至少 1280）和窄屏截图（宽度不高于 760），不要求 RISEMAP 截图、像素差或双侧同材料。
- interaction 有真实 Forge 正常路径记录；business 有独立 Forge 结果回读证据。接口结果不能代替页面办理或独立业务读回。
- permissions 至少记录两个不同主体，并证明应允许和应拒绝的操作；角色证据中的账号与操作者一致。
- 有状态写入要求必须以同一持久数据库完整停服、重启和读回；全只读功能可以声明 `scope: "not_applicable"`，写明理由并由独立复核者提供范围确认。
- `stateEffect: "changes_configuration"` 的要求必须逐项关联 `settingsConsumers`，证明配置已在目标业务消费者中产生预期实际效果；保存提示或重启读回本身不够。
- performance 记录 `coldOpenMs`、`refreshMs`、`navigationMs`、`requestCount` 和 `transferBytes`，每项含实测值、预算、预算来源和固定材料下的性能证据。
- review 的 implementer 与 reviewer 必须不同；复核决议为 accepted，并绑定同一 `reviewedRevision`。

`source.type` 使用 `user_goal`、`customer_rule`、`forge_decision` 或 `external_reference`。外部参考可以不采用；若某项要求来源于外部参考，必须用 `referenceId` 关联 `referenceEvidence`。review_required 条目不得附带总体成功报告或已验收证据。

旧 schemaVersion 1/2 记录保持原样并继续按旧门禁验证；不为迁移补造 RISEMAP 证据，不批量改 manifest 状态。证据文件自身不放入 subjectFiles，避免形成摘要循环。目标文件变化后，旧 SHA 和对应验收失效。
