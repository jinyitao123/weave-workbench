# Forge 组装业务管理页面合同（2026-09-17）

依据 `docs/forge-page-delivery-standard.md`、`docs/forge-page-polish-baseline.md`
与 `docs/evidence/risemap-production-assembly-live-20260917.md`。

## 批次与范围

- 本批业务链：生产 → **组装业务管理** 全部功能页，共 8 个页面。
- 页面与源文件：
  `page_production_prerequisites`（生产准备检查）、`page_production_assembly_workspace`（组装单）、
  `page_production_shortage_workspace`（缺料待办）、`page_production_material_workspace`（领料单）、
  `page_production_supply_workspace`（补料单）、`page_production_return_workspace`（退料单）、
  `page_production_disassembly_workspace`（拆解单）、`page_production_replacement_workspace`（换件单）。
- 共享视觉与交互落在 `src/pages/product-ui.ts`：品牌标识区色调与线稿（`ForgeHero` 的 `tone`/`art`）、
  指标条（`ForgeMetricStrip`）、状态页签（复用 `.fp-tabs`）、动作行（`.fp-action-row`）、
  列表卡（`.fp-list-card`）、筛选行（`.fp-filter-row`）、空态（`ForgeEmpty`）与分页（`.fp-pagination`）。
- 组装单与缺料待办两个页面首次接入 `forgeProductUiCss`：此前它们只有页面自有 CSS，
  共享控件（列表卡、页签、分页）没有样式，属本批修正的缺陷。

## 逐页设计与实现

| 页面 | 岗位 / 核心任务 | 首屏区块顺序 | 状态与阻断 | 结果 |
| --- | --- | --- | --- | --- |
| 组装单 | 生产计划员 / 按 BOM 组装并分批入库 | hero → 4 指标卡 → 8 状态页签 → 新建组装单+导出+导入/导出任务+刷新 → 搜索 → 12 列宽表 → 分页 | 沿用现有对象与 Action：草稿 → 审批中 → 待领料 → 组装中 → 已完工；驳回与取消保留 | 已实现并回读 |
| 缺料待办 | 生产计划员 / 按计划完工日期取库存分配优先级 | hero → 4 指标卡 → 刷新 → 缺料明细宽表（含缺口金额）→ 分页 | 只读分析页，缺口按成本单价折算 | 已实现并回读 |
| 领料单 | 领料员 / 组装领料与库存过账 | hero → 4 指标卡 → 5 状态页签 → 新建+导出+导入/导出任务+刷新 → 搜索 → 10 列宽表 → 分页 | 审批中/已确认/已驳回/已作废沿用现有 Action | 已实现并回读 |
| 补料单 | 领料员 / 超 BOM 用量补领 | 同上（4 指标卡为补料口径） | 同上 | 已实现并回读 |
| 退料单 | 领料员 / 余料退库 | 同上（含仓库列） | 同上 | 已实现并回读 |
| 拆解单 | 生产执行 / 成品还原为物料 | hero → 4 指标卡（回收绿 / 报废红）→ 8 状态页签 → 动作行 → 搜索 → 9 列表 → 分页 | 草稿 → 审批中 → 待领料 → 拆解中 → 已完工 → 已入库 | 已实现并回读 |
| 换件单 | 生产执行 / 换件不离库 | hero → 4 指标卡（新件成本红 / 旧件回收绿）→ 8 状态页签 → 动作行 → 搜索 → 10 列表 → 分页 | 同上（换件中） | 已实现并回读 |
| 生产准备检查 | 生产主管 / 开工前资料核对 | hero → 4 指标卡 → 检查状态与重新检查 → 三组检查项就地办理 | 检查项「查看 / 去补充」跳转到对应业务页 | 已实现并回读（Forge 决策页） |

## RISEMAP 对齐与 Forge 决策

- 已按 RISEMAP 对齐：hero 面包屑/标题/说明文案与色调、指标卡口径与金额格式（缺口总额、
  回收价值、报废损耗、新件成本、旧件回收价值）、状态页签名称与计数、动作行顺序与主按钮位置、
  搜索占位文案、表头逐列顺序、空态文案与分页每页 20 条。
- Forge 决策（RISEMAP 无对应事实或需保留办理能力）：
  - 拆解单与换件单保留「操作」列（RISEMAP 空态表头没有该列）；没有它就没有办理入口。
  - 领料单不提供「全部类型」下拉：Forge 的领料/补料/退料已按单据类型拆成三个菜单页，该筛选项会恒等于当前页类型。
  - 列表状态以单号下方小字呈现（RISEMAP 只在页签体现状态），避免多出一列。
  - 生产准备检查为 Forge 页（RISEMAP 无对应页面），内容为组装、图纸、委外开始前的资料核对。
  - 缺料待办的数据态列表（含缺口金额列）为 Forge 扩展；RISEMAP 抓取时为空态，只有空态面板事实。

## 已知缺口（不放假按钮）

- RISEMAP 动作行右侧还有「列设置」与「设置」两个图标按钮，当前未实现，记录为缺口。
- RISEMAP 各页的导出是后台导出任务；Forge 用前端 CSV 下载 + 导入/导出任务页承载，属产品决策差异。
- 「批量导入」「批量操作」「行勾选」在 Forge 尚无真实能力，未放置控件。

## 验证

- 浏览器回读：`pnpm acceptance:production-assembly-group`
  （`tests/production-assembly-group-ui-readback.mjs`，17 项通过），截图见
  `docs/evidence/production-assembly-group/`。
- 回读覆盖：hero 文案与色调、指标卡口径、状态页签过滤、搜索与清空、导出真实 CSV、
  导入/导出任务页、行内查看详情、新建表单、缺料分页、窄屏布局。
- 门禁：`pnpm typecheck`、`pnpm validate`、`pnpm build` 全部通过。
- 本组页面仍为 `review_required`：RISEMAP 侧租户数据为空态，无法用同一组业务数据并排办理，
  因此不得称为「已复刻」或「验收通过」。
