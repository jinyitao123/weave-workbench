# Forge 委外管理页面合同（2026-09-17）

依据 `docs/forge-page-delivery-standard.md`、`docs/forge-page-polish-baseline.md`。
RISEMAP 事实来源：`docs/references/risemap-capture/deep/production/subcontract*/`
（RM-081 至 RM-093）与 `docs/risemap-page-contracts.json`。

## 批次与范围

生产 → **委外管理** 全部 14 个功能页：
`page_subcontract_guide`（上手指南）、`page_subcontract_dashboard`（委外看板）、
`page_subcontract_workspace`（委外订单）、`page_subcontract_issue_workspace`（委外发料）、
`page_subcontract_receipt_workspace`（委外回厂）、`page_subcontract_return_workspace`（委外退料）、
`page_subcontract_reconciliation`（委外对账）、`page_subcontract_suppliers`（委外供应商）、
`page_subcontract_pricing`（加工价目）、`page_subcontract_stock`（委外厂库存）、
`page_subcontract_trace`（委外批次追溯）、`page_subcontract_undelivered`（委外未交明细表）、
`page_subcontract_inbound_report`（委外进货明细表）、
`page_subcontract_reconciliation_report`（委外对账单报表）。

## RISEMAP 事实与本批对齐

| 页面 | RISEMAP 标题 / 说明 | 列与控件事实 | 本批结果 |
| --- | --- | --- | --- |
| 委外看板 | 委外业务全景；进行中 / YTD 未结 / 整体良率 | 5 张指标卡（进行中订单、待发料订单、待回厂订单、待对账订单、逾期订单）+ 看板页签 | hero + 动作行 + 指标卡口径一致 |
| 委外订单 | 整件委外 / 甲供料 — 加工件下单、发料、回厂、对账闭环 | 10 列（订单号/供应商/关联/付款条件/加工费/发料进度/回厂进度/对账进度/交期/操作） | hero；列此前已一致 |
| 委外发料 | 管理甲供物料出库、交接与供应商签收 | 8 列（发料单号/供应商/关联委外订单/交接时间/经办人/物料概况/发料数量/操作） | hero + 动作行；列一致 |
| 委外回厂 | 集中查询回厂验收结果、关联入库单与对账依据 | 9 列（回厂记录号/供应商/关联委外订单/回厂日期/质检员/加工件概况/验收结果/关联入库单/操作） | hero；列一致（Forge 用「外协厂商 / 关联订单」措辞） |
| 委外退料 | 集中管理委外余料、工程变更及错发物料的退回和入库记录 | 7 列（退料单号/供应商/关联委外订单/退料日期/物料概况/退料结果/操作） | hero；Forge 多一列「退料原因」（记录为差异） |
| 委外对账 | 集中管理加工费、补料费用、损耗扣款及应付生成进度 | 6 列（供应商/订单数/涉及委外订单/回厂单数/待对账金额/操作）+ 待对账池/对账单页签 | hero；列一致 |
| 委外供应商 | 维护工艺能力、信用等级、加工价目表；准时率与良率由已完成单据派生 | 搜索 + 全部工艺能力筛选；供应商卡片 | hero + RISEMAP 说明文案已对齐 |
| 加工价目 | RISEMAP 无此页（Forge 产品决策） | — | hero + 动作行（新增价目/刷新） |
| 委外厂库存 | 按 委外订单 + 物料 维度查询发到外协厂的在途库存 | 超 30 天 SKU、供应商/物料视角、库龄筛选 | hero |
| 委外批次追溯 | 基于回厂倒冲记录的材料↔成品批次关联 | 正向/反向追溯 + 批次输入 | hero |
| 委外未交明细表 | 按行展开所有未回完的委外订单 — 锁定卡单、提前预警超期 | 12 列（含已回（良/不良）、未交、未交金额、期望交期、超期） | hero；列一致 |
| 委外进货明细表 | 按物料行展开明细 — 用于回厂进度核验、加工费核算与供应商良率统计 | 18 列 | hero；列一致 |
| 委外对账单（报表） | 对账数据查询视图 — 支持按对账单汇总或按费用明细行查询 | 10 列 | hero；列一致 |
| 上手指南 | 按实际业务任务快速完成订单、发料、回厂和对账 | 角色切换 + 分步任务 | hero + 打开委外看板入口 |

## 本批改动与决策

- 14 个页面全部接入品牌标识区（面包屑「生产 › 委外管理 › 页面名」、图标徽章、标题、
  RISEMAP 说明原文、按页色调与线稿装饰），并清理页内重复的旧标题区，避免一页两套标题。
- 委外发料/回厂/退料的旧标题行改为共享动作行（主按钮在左，刷新在右），与组装、图纸两组一致。
- 加工价目保留（RISEMAP 无对应页），按 Forge 决策给出同一套标题区与动作行。
- 已知差异（记录，不以占位控件掩盖）：委外回厂用「外协厂商 / 关联订单」措辞、
  委外退料多一列「退料原因」、委外订单看板把「新建委外订单」放在看板主体而非动作行、
  RISEMAP 的「导出记录 / 导入 / 更多筛选 / 列设置」等按钮在 Forge 侧未实现。

## 验证

- 浏览器回读：`pnpm acceptance:subcontract-group`（14 项通过），截图见
  `docs/evidence/subcontract-group/`；每页断言 hero 面包屑、标题、RISEMAP 说明文案与色调，
  并检查旧标题区已移除。
- 逐页人工查看截图确认渲染：看板、订单、发料、回厂、退料、对账、供应商、加工价目、
  库存、追溯、未交、进货、对账单、指南均正常。
- 门禁：`pnpm typecheck`、`pnpm validate`、`pnpm build` 全部通过。
- 与组装、图纸两组相同，本组页面仍为 `review_required`：未在同一组业务数据上与 RISEMAP
  并排办理，不得称「已复刻」或「验收通过」。
