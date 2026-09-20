# Forge 供应链 · 基础资料页面合同（2026-09-17）

依据 `docs/forge-page-delivery-standard.md` 与 `docs/forge-page-polish-baseline.md`。
RISEMAP 事实来源：`docs/references/risemap-capture/deep/supply-chain/master-data/`
（rm-010 至 rm-016）与 `docs/risemap-page-contracts.json`（RM-011/012/013/015）。

## 范围

供应链 → 基础资料 4 个页面：`page_material_combinations`（物料组合）、
`page_bom_workspace`（BOM管理）、`page_material_search`（综合物料搜索）、
`page_product_trace`（产品实例追溯）。

## 逐页对照结果

| 页面 | RISEMAP 列（原文） | 本批处理 |
| --- | --- | --- |
| 物料组合 | 编号、组合名称、物料种类、含税销售价、不含税销售价、状态、引用次数、创建人、创建日期、操作 | 列本已一致；搜索占位改为 RISEMAP 的「搜索组合名称或编号...」，动作行补上真实「导出」（原只有导入/导出弹窗），按钮顺序改为 新建物料组合 → 批量启用/批量停用 → 导入/导出 → 导出 → 刷新 |
| BOM管理 | BOM编号、BOM名称、产品/设备、BOM类型、当前版本、状态、适用项目、物料数、成本、更新时间、创建人、操作（12 列） | 列表由 8 列重排为 RISEMAP 12 列（新增 编号、产品/设备、更新时间、创建人、操作）；新增 RISEMAP 的 6 个状态页签（全部/草稿/待评审/已生效/已失效/已归档，带计数）；搜索占位改为「搜索编号/名称/产品...」；列表页补品牌标识区 |
| 综合物料搜索 | 无列、无按钮，只有一个全局搜索框 | 说明改为 RISEMAP 原文「全局搜索物料编码/名称/型号/品牌/供应商/物料组合/SN码/批次号等，快速查看完整信息、利润、价格趋势及历史」；搜索占位对齐 |
| 产品实例追溯 | 追溯码、编码、物料名称、型号、规格、SKU编码、SKU条码、物料条码、外部SN、来源类型、状态、质保状态、客户名称、发货日期 | 三个页签中的「产品实例」表已对齐其中 13 列；面包屑与搜索占位对齐 |

## 缺口（记录，不放假控件）

- 产品实例追溯的「质保状态」列：Forge 的序列号/物料对象没有质保字段，不新增空列。
- RISEMAP 的第 4 个页签「质保管理」：Forge 无质保数据模型，未放置空页签。
- BOM管理的「新建BOM / 导入导出 / BOM对比」：Forge 该页没有对应 Action，未放置按钮。
- RISEMAP 物料组合的「批量」是下拉；Forge 拆成「批量启用 / 批量停用」两个真实按钮。

## 验证

- 浏览器回读与截图：`docs/evidence/supply-chain-master-data/`（4 页 hero、列、页签、空态）。
- 产品实例页签单独特写截图 `page_product_trace-instance.png` 证明 13 列。
- 门禁：typecheck / validate / build 通过；本组页面仍为 `review_required`。
