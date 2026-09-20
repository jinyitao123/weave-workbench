# Forge 供应链同批页面合同（2026-09-16）

本文件登记供应链“同类缺陷整改”批次的页面，与 `docs/forge-page-defect-inventory-20260916.md` 配套使用。整改项来自用户明确要求：标题、面包屑与业务导航不重复堆叠；窄屏不重叠；宽表状态与操作列可达；日期起止含义明确。改动属 Forge 页面质量标准，不改变 RISEMAP 业务事实、字段含义、状态或阻断规则。

## 其他入库（page_other_inbounds）

- 岗位：仓库收货与库管；主单据：其他入库单。
- 主原型：任务执行型，参考 `project-task-workspace.page.ts`。
- 整改前事实：列表视图只渲染一条自绘面包屑“入 入库管理 / 其他入库”，页面没有自己的标题，说明文字单独一行；因此首屏缺少明确页面标题。
- 处理：改为共享 `ForgePageHeader`，标题“其他入库”、说明“管理所有其他入库单据”，原有工具箱（新建其他入库、打印条码、导出、刷新）完整保留在同一位置；删除重复面包屑与重复说明行。新建、详情两个子视图的子路径保持不变。
- 表格：列表 12 列原先只依赖默认 850px 宽度，入库单号与状态 / 操作列会被挤压。改为列表单独声明 `min-width:1180px`，入库单号固定在左、状态与操作固定在右并加分隔阴影；物料明细表保持原有 `fp-line-table` 规则。
- 验收材料：静态断言 `apps/forge-objectstack/tests/other-inbound-page.static.mjs`；验收记录 `apps/forge-objectstack/tests/page-acceptance/page_other_inbounds.json`。
- 未决：本轮没有实时 RISEMAP 对照，也没有浏览器实操、桌面 / 窄屏截图与控制台扫描；`designStatus` 保持 `review_required`。

## 后续同类页面

## 其他出库（page_other_outbounds）

- 岗位：仓库出库与库管；主单据：其他出库单。
- 主原型：任务执行型。
- 整改前事实：列表视图先渲染自绘面包屑“出 出库管理 / 其他出库”并附带新建 / 刷新动作，紧接着又渲染一份独立标题区“其他出库 + 管理所有出库单和待出库发货单”，同一屏出现两条模块路径与两段标题语义；该页此前不在精修清单内。
- 处理：合并为共享 `ForgePageHeader`，标题“其他出库”、说明沿用原文，新建其他出库与刷新两个动作保留在标题右侧；新建 / 编辑子视图的“新建其他出库单 / 编辑其他出库草稿”路径保留。已把该页补入 `tests/page-polish.manifest.json` 的 supply_chain 段。
- 验收材料：静态断言 `apps/forge-objectstack/tests/other-outbound-page.static.mjs`；验收记录 `apps/forge-objectstack/tests/page-acceptance/page_other_outbounds.json`。
- 未决：无实时 RISEMAP 对照、无浏览器实操与截图，`designStatus` 保持 `review_required`。

同一缺陷仍存在的供应链页面（见缺陷清单）按同样方式逐页整改，每页单独登记静态断言与验收记录，未经浏览器复核不得标为已精修。
