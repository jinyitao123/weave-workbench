# 逐页交付合同与验收记录模板

复制本模板至本批合同文件，按实际页面填写；占位内容不得作为验收证据。

## 批次和范围

- 总目标 / 本批业务链 / 实施负责人 / 独立复核者：
- 起始版本 / 分支 / 工作树 / FORGE_URL / SQLite 文件：
- 全量范围来源：导航、页面注册、内部跳转、列表、新建、详情、表单、弹窗。
- 本批具体页面 / 排除项及理由 / 下一批：
- 共享文件的唯一负责人 / 跨域接口 / 未实现、交互欠缺、证据不足清单：

## 逐页设计（每页单独填写）

- pageId / RISEMAP 当前入口 / Forge 入口：
- 岗位 / 核心任务 / 主单据 / 来源 / 下一岗位：
- 主原型 / 选择理由 / 参考源文件、版本和截图：
- 首屏区块顺序 / 主动作与位置 / 次要动作：
- 全局范围与局部筛选作用对象 / 指标口径与追溯：
- 字段和列顺序 / 状态 / 联动 / 阻断 / 提交反馈 / 下一步：
- 桌面与窄屏视口 / 有数据、空态、错误、提交中、受限及弹窗呈现：
- 几何压力检查：标准桌面 / Console 侧栏占宽后的实际内容宽度 / 窄屏；长单号 / 长客户名 / 长选择项 / 最多操作按钮状态；按钮、输入框、选择器、日期控件、页签、表格列、行操作、弹窗底部动作的边界框；重叠、挤压、异常收缩、竖排、非预期换行、截断、错位、越界和卡片内滚动结果：
- 像素对照：相同视口与缩放 / 业务内容裁剪框 / RISEMAP 原图 / Forge 原图 / 叠图或差异图 / 不同像素比例 / 主要元素最大几何偏差 / 动态区域排除及理由：

| 要求编号 | 当前事实或明确决策与证据 | 区域/控件及实现位置 | 操作步骤 | 预期结果 | 实际结果与证据 | 状态/缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-001 | 待填写，不以推断充当事实 | | | | | pending |

对所有可见控件逐项登记，至少覆盖正常路径、关键异常及下一岗位。仅隐藏未实现按钮不能删除该行需求。纯只读页面的表单项可说明不适用并提供页面职责证据，不得用不适用掩盖尚未实现的动作。

## 验收与交接

- 四维结果：replication / visual / interaction / business 各填 pending、pass、blocked 或 fail。
- 双侧同材料 / API / 工程门禁 / 同库完整停服重启回读：步骤、实际结果和文件路径。
- 独立复核：人员/会话标识、日期、复现结果与退回缺陷；未发生就写待独立验收。
- 已证明、明确差异、复用证据及理由、剩余问题、下一步：
- 实际耗时/调用/费用、首次验收结果、返工原因：无可靠来源写未知。

## 结构化记录

另存为 JSON，所有路径相对仓库根目录。manifest 条目增加 `contract` 指向本合同、`acceptance` 指向该 JSON；只有总体 accepted 时增加 `evidence` 指向验收报告。review_required 可逐步保存部分结果，不能填写总体通过报告字段。

下面是未验收模板。新记录使用 schemaVersion 2；`reviewedRevision` 填真实的 40 位 Git 提交号；`subjectFiles` 填被验收文件的真实 SHA-256。先提交实现，再取证，最后提交证据，避免把证据文件本身放进 subjectFiles 造成循环。四个必填文件是页面源码、product-ui.ts、所选参考源码和 forge-page-polish-baseline.md；另补受本页依赖的对象、Action、服务与导航配置。

```json
{
  "schemaVersion": 2,
  "pageId": "page_REPLACE",
  "archetype": "task_workspace",
  "reviewedRevision": "",
  "subjectFiles": {},
  "environment": { "forgeUrl": "", "database": "", "materials": "" },
  "checks": {
    "replication": { "status": "pending", "notes": "", "evidence": [] },
    "visual": { "status": "pending", "notes": "", "evidence": [] },
    "interaction": { "status": "pending", "notes": "", "evidence": [] },
    "business": { "status": "pending", "notes": "", "evidence": [] }
  },
  "visualEvidence": {
    "desktop": { "width": 1440, "height": 900, "evidence": [] },
    "narrow": { "width": 390, "height": 844, "evidence": [] },
    "reference": [], "populated": [], "empty": [], "form": [], "error": []
  },
  "pixelComparisons": [
    {
      "kind": "desktop",
      "viewport": { "width": 1440, "height": 900, "scale": 1 },
      "crop": { "x": 0, "y": 0, "width": 1440, "height": 900, "reason": "业务内容区；如裁掉 Console 外壳需填写真实坐标与理由" },
      "risemap": [],
      "forge": [],
      "diff": [],
      "geometry": { "risemap": [], "forge": [] },
      "tool": "pixelmatch 7.2.0",
      "mismatchedPixelRatio": 1,
      "maxGeometryDeltaPx": 999,
      "exclusions": []
    },
    {
      "kind": "narrow",
      "viewport": { "width": 390, "height": 844, "scale": 1 },
      "crop": { "x": 0, "y": 0, "width": 390, "height": 844, "reason": "业务内容区；如裁掉 Console 外壳需填写真实坐标与理由" },
      "risemap": [],
      "forge": [],
      "diff": [],
      "geometry": { "risemap": [], "forge": [] },
      "tool": "pixelmatch 7.2.0",
      "mismatchedPixelRatio": 1,
      "maxGeometryDeltaPx": 999,
      "exclusions": []
    }
  ],
  "requirements": [
    { "id": "REQ-001", "status": "pending", "steps": "", "expected": "", "observed": "", "evidence": [] }
  ],
  "review": { "implementer": "", "reviewer": "", "reviewedAt": "", "status": "pending", "evidence": [] }
}
```

每份几何测量 JSON 使用下面的结构。`elements` 坐标相对业务内容裁剪框，RISEMAP 与 Forge 使用完全相同的元素 `id`；至少测量标题区、主动作区、筛选区、主要内容区和分页或下一步区五项，复杂页面继续增加指标、页签、表格、空态和弹窗。

```json
{
  "viewport": { "width": 1440, "height": 900, "scale": 1 },
  "crop": { "x": 0, "y": 80, "width": 1440, "height": 820, "reason": "业务内容区" },
  "elements": [
    { "id": "title", "x": 24, "y": 20, "width": 180, "height": 32 },
    { "id": "toolbar", "x": 24, "y": 68, "width": 820, "height": 36 },
    { "id": "filters", "x": 24, "y": 116, "width": 1392, "height": 84 },
    { "id": "table", "x": 24, "y": 216, "width": 1392, "height": 520 },
    { "id": "pagination", "x": 24, "y": 748, "width": 1392, "height": 44 }
  ]
}
```

accepted 时每个 evidence 数组都必须含真实非空文件路径。纯只读页面的 form 数组填写解释不适用且经过复核的合同/报告路径；机器检查不推断适用性，复核者负责核实。视觉图像及操作证据应脱敏，不提交登录态、运行数据库、环境文件或秘密。
