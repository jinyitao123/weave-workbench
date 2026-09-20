# Forge 供应链全量页面设计清单

日期：2026-09-15

分支：`codex/supply-chain-next-review`

独立运行约束：端口 `4422`，SQLite `apps/forge-objectstack/.objectstack/acceptance/supply-chain-pages-4422.sqlite`

## 结论与状态口径

- 供应链导航共 42 个页面入口，与 RISEMAP 当前供应链六个分组一一对应。
- 当前所有页面设计状态均为 `review_required`。专用页面、业务脚本和历史浏览器证据只证明已有实现，不自动构成统一设计验收。
- `采购待办池`、`询价管理`、`供应商价格本` 当前仍由 `supply-production-routing.page.ts` 的同一整页生成器承载，属于通用套壳，必须拆成独立页面。
- `物料管理`、`供应商管理`、`仓库管理` 当前使用标准对象页。后续需逐页核对列表列、工具栏、表单、详情、空态和窄屏；标准对象页能完整承载时保留，否则改为独立业务页。
- 每页只有完成 RISEMAP 与 Forge 双侧实时页面对照、主原型核对、真实主动作与阻断、操作后回读、桌面与窄屏、API 和同一 SQLite 重启回读，才能改为 `accepted`。

## 全量清单

| 分组 | RISEMAP | Forge 页面 | 主原型 / 参考 | 当前实现 | 设计状态 |
| --- | --- | --- | --- | --- | --- |
| 到货检验 | [到货通知](https://risemap.cn/inventory/arrival-notices) | `page_purchase_arrival_notice` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 到货检验 | [到货登记](https://risemap.cn/inventory/arrival) | `page_purchase_arrival_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 到货检验 | [待检验库存](https://risemap.cn/inventory/pending-inspection) | `page_pending_inspection_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 到货检验 | [检验单](https://risemap.cn/inventory/inspection) | `page_purchase_inspection_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 到货检验 | [检验规则](https://risemap.cn/inventory/inspection-rules) | `page_inspection_rules` | 配置型 / 工时管理 | 专用页面，已有功能证据，待双侧设计复核 | `review_required` |
| 基础资料 | [物料管理](https://risemap.cn/base/products) | `forge_material` | 配置型 / 工时管理 | 标准对象页，待核对列表、表单与响应式 | `review_required` |
| 基础资料 | [物料组合](https://risemap.cn/base/product-bundles) | `page_material_combinations` | 配置型 / 工时管理 | 专用页面，已有功能证据，待双侧设计复核 | `review_required` |
| 基础资料 | [BOM管理](https://risemap.cn/base/bom) | `page_bom_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 基础资料 | [综合物料搜索](https://risemap.cn/base/material-search) | `page_material_search` | 分析型 / 工时管理 | 专用页面，已有功能证据，待双侧设计复核 | `review_required` |
| 基础资料 | [供应商管理](https://risemap.cn/base/suppliers) | `forge_supplier` | 配置型 / 工时管理 | 标准对象页，待核对列表、表单与响应式 | `review_required` |
| 基础资料 | [产品实例追溯](https://risemap.cn/base/barcode-center) | `page_product_trace` | 分析型 / 工时管理 | 专用页面，已有功能证据，待双侧设计复核 | `review_required` |
| 基础资料 | [仓库管理](https://risemap.cn/base/warehouses) | `forge_warehouse` | 配置型 / 工时管理 | 标准对象页，待核对列表、表单与响应式 | `review_required` |
| 采购管理 | [采购发票](https://risemap.cn/purchase/invoices) | `page_purchase_invoice_entry` | 任务执行型 / 任务管理 | 专用页面，已有功能证据，待双侧设计复核 | `review_required` |
| 采购管理 | [采购申请](https://risemap.cn/purchase/requests) | `page_purchase_request_pool` | 任务执行型 / 任务管理 | 专用页面；功能、阻断、重启回读已有证据，RISEMAP 同材料路径缺失 | `review_required` |
| 采购管理 | [采购待办池](https://risemap.cn/purchase/pending-pool) | `page_purchase_todo_pool` | 任务执行型 / 任务管理 | 通用路由套壳，业务办理未实现 | `review_required` |
| 采购管理 | [询价管理](https://risemap.cn/purchase/rfq) | `page_purchase_inquiry` | 任务执行型 / 任务管理 | 通用路由套壳，业务办理未实现 | `review_required` |
| 采购管理 | [采购订单](https://risemap.cn/purchase/orders) | `page_purchase_order_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 采购管理 | [采购退换货](https://risemap.cn/purchase/returns) | `page_purchase_return` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 采购管理 | [供应商价格本](https://risemap.cn/purchase/pricebook) | `page_supplier_price_book` | 配置型 / 工时管理 | 通用路由套壳，业务办理未实现 | `review_required` |
| 入库管理 | [全部入库单](https://risemap.cn/inventory/inbound) | `page_all_inbounds` | 分析型 / 工时管理 | 专用聚合页面，待逐页设计复核 | `review_required` |
| 入库管理 | [采购入库](https://risemap.cn/inventory/inbound/purchase) | `page_purchase_inbound_workspace` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 入库管理 | [生产入库](https://risemap.cn/inventory/inbound/production) | `page_production_inbound_entry` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 入库管理 | [其他入库](https://risemap.cn/inventory/inbound/other) | `page_other_inbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 入库管理 | [期初入库](https://risemap.cn/inventory/inbound/opening) | `page_opening_inbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 入库管理 | [入库明细](https://risemap.cn/inventory/inbound/details) | `page_inbound_lines` | 分析型 / 工时管理 | 专用聚合页面，待逐页设计复核 | `review_required` |
| 库存管理 | [库存总览](https://risemap.cn/inventory/overview) | `page_inventory_overview` | 工作台型 / 工作台 | 专用五视图页面，待逐页设计复核 | `review_required` |
| 库存管理 | [不合格处理](https://risemap.cn/inventory/ncr) | `page_inventory_ncr` | 任务执行型 / 任务管理 | 专用聚合页面，待逐页设计复核 | `review_required` |
| 库存管理 | [处置执行中心](https://risemap.cn/inventory/ncr/disposal) | `page_inventory_disposal_center` | 任务执行型 / 任务管理 | 专用聚合页面，RISEMAP 当前入口需实时复核 | `review_required` |
| 库存管理 | [库存流水](https://risemap.cn/inventory/flow) | `page_inventory_ledger` | 分析型 / 工时管理 | 专用只读审计页面，待逐页设计复核 | `review_required` |
| 库存管理 | [库存锁定](https://risemap.cn/inventory/lock) | `page_inventory_locks` | 任务执行型 / 任务管理 | 专用页面，已有办理证据，待双侧设计复核 | `review_required` |
| 库存管理 | [库存盘点](https://risemap.cn/inventory/check) | `page_inventory_count` | 任务执行型 / 任务管理 | 专用页面，已有办理证据，待双侧设计复核 | `review_required` |
| 库存管理 | [调拨与借出](https://risemap.cn/inventory/transfer) | `page_inventory_transfer` | 任务执行型 / 任务管理 | 专用页面，已有办理证据，待双侧设计复核 | `review_required` |
| 库存管理 | [库存预警](https://risemap.cn/inventory/alerts) | `page_inventory_alerts` | 工作台型 / 工作台 | 专用页面，待逐页设计复核 | `review_required` |
| 库存管理 | [报损单](https://risemap.cn/inventory/damage) | `page_inventory_loss` | 任务执行型 / 任务管理 | 专用页面，已有办理证据，待双侧设计复核 | `review_required` |
| 库存管理 | [SN码管理](https://risemap.cn/inventory/sn-verify) | `page_inventory_sn` | 分析型 / 工时管理 | 专用双页签页面，已有验证证据，待双侧设计复核 | `review_required` |
| 出库管理 | [出库单列表](https://risemap.cn/inventory/outbound) | `page_sales_outbound_list` | 分析型 / 工时管理 | 专用聚合页面，待逐页设计复核 | `review_required` |
| 出库管理 | [生产出库](https://risemap.cn/inventory/outbound/production) | `page_production_outbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 出库管理 | [其他出库](https://risemap.cn/inventory/outbound/other) | `page_other_outbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 出库管理 | [销售直接出库](https://risemap.cn/inventory/outbound/sales-direct) | `page_sales_direct_outbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 出库管理 | [待出库发货单](https://risemap.cn/inventory/outbound/shipments) | `page_pending_outbound_shipments` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 出库管理 | [采购退换货出库](https://risemap.cn/inventory/outbound/purchase-returns) | `page_purchase_return_outbounds` | 任务执行型 / 任务管理 | 专用页面，待逐页设计复核 | `review_required` |
| 出库管理 | [出库明细](https://risemap.cn/inventory/outbound/details) | `page_outbound_lines` | 分析型 / 工时管理 | 专用聚合页面，待逐页设计复核 | `review_required` |

## 实施批次

1. 采购申请检查点复核，保持 `review_required`；随后拆分采购待办池、询价管理和供应商价格本三个通用套壳页。
2. 采购订单、采购退换货和采购发票逐页调整，确保采购申请到订单、到货、收票、付款的下一步入口连续。
3. 到货通知、到货登记、待检验库存、检验单和检验规则逐页设计复核。
4. 全部入库、采购入库、生产入库、其他入库、期初入库和入库明细逐页设计复核。
5. 库存总览、流水、锁定、盘点、调拨、预警、报损、SN 和处置页逐页设计复核。
6. 出库单、生产/其他/销售直接/采购退换货出库、待出库发货单和出库明细逐页设计复核。
7. 物料、供应商、仓库标准对象页及物料组合、BOM、搜索、追溯页面做最终统一样式、密度、响应式和交互检查。

## 集成边界

- 本分支不自行修改全局导航、共享 `product-ui.ts`、`src/pages/index.ts` 或 `package.json`。
- 页面注册、公共控件或脚本入口确有必要时，单独列出集成需求，由主线统一处理。
- 本分支不合并或推送 `main`，只按可审查批次提交 SHA。
