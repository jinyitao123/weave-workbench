# Forge 全部入库单页面合同（2026-09-16）

## 页面职责

- RISEMAP 当前入口：`https://risemap.cn/inventory/inbound`；新建入口：`/inventory/inbound/new`。
- Forge 入口：`/_console/apps/forge/page/page_all_inbounds`。
- 岗位：仓库经办、采购收货、生产入库、委外收货和库存复核人员。
- 主原型：分析型，参考 `project-timesheet-cost.page.ts` 的筛选、聚合列表和分页；新建分流使用共享标准弹窗。
- 页面职责：统一查询采购、生产、其他、期初、委外入库，并按真实来源进入专用办理页面；本页不绕过来源单据直接改库存。

## RISEMAP 当前已观察事实

- 标题为“全部入库单”，说明为“管理所有入库单据”。
- 工具栏包含新建入库单、打印条码、导出、刷新；打印条码以勾选记录为作用对象。
- 筛选包含搜索、状态、类型和来源。
- 列包含勾选、入库单号、类型、来源、入库类型、批次号、供应商/客户、仓库、入库日期、含税金额、状态、创建人和操作。
- 当前存在一条期初入库记录 `IN-2026-0001`，来源为手动入库、状态为已入库。
- 新建页当前提供采购入库、其他入库、退货入库；采购入库要求先选择供应商，再选择该供应商尚未全部入库的采购订单。
- RISEMAP 已入库行仍显示删除按钮，但本轮未点击删除确认，也未执行线上删除。

## Forge 处理结论

- 从 `supply-production-routing.page.ts` 拆为独立 `all-inbounds.page.ts`，使用 `ForgePageHeader`、共享筛选、状态、空态和标准弹窗。
- 聚合采购、生产、其他、期初和委外五类已持久化入库单，保留来源、金额、仓库和负责人信息；其他入库按客户/供应商类型显示真实往来单位。
- 勾选当前页或单行后才允许打印；打印预览仅包含已勾选记录，不再错误打印全部筛选结果。
- 新建入口对齐 RISEMAP 三类业务，但 Forge 进入各自专用工作台：采购入库、其他入库、销售退货。该平台呈现差异用于保留检验、审批和来源阻断。
- 不提供已入库记录删除动作。RISEMAP 的删除影响、库存回滚和关联明细处理尚未获得可执行证据；Forge 不以删除按钮包装未验证能力。

## 状态、来源与下一步

- 状态覆盖草稿、待处理、待审批、已审批、已入库、已完成、已取消。
- 来源覆盖采购订单、采购换货补货、组装单、手动入库、委外回厂。
- 查看详情进入对应采购、生产、其他、期初或委外页面；新建不会在聚合页直接写入库存。
- 采购入库仍由已完成且存在合格数量的采购检验单约束；本页不替代采购入库 Action 验收。

## 待 RISEMAP 同材料复核

- RISEMAP 已入库记录的删除确认内容、允许条件、库存回滚和关联单据影响仍待复核。
- RISEMAP 统一新建页的保存草稿、提交审批及退货入库完整路径未使用同一材料执行。
- 页面精修状态保持 `review_required`，不因列表可打开或 Forge 本地夹具通过而改为 `accepted`。

## 验收材料

- 页面结构：`tests/all-inbounds-dedicated-page.static.mjs`
- API：`tests/all-inbounds.integration.mjs`
- 同一 SQLite 重启回读：`tests/all-inbounds-restart-readback.mjs`
- 浏览器：RISEMAP `/inventory/inbound`、`/inventory/inbound/new` 与 Forge `page_all_inbounds` 的勾选、打印预览、新建分流、筛选、桌面和窄屏检查。
- 本轮运行：独立端口 `4495`、数据库 `file:.objectstack/supply-procurement-batch1.sqlite`。Forge 页面同时回读采购入库 `PIN-2026-0001` 与其他入库 `OIN-2026-49774085`；其他入库金额 ¥8,400.00、客户、仓库和已入库状态与来源详情一致。勾选后打印按钮显示 1 条且预览只含所选记录；390×844 下无页面横向溢出；完整停服重启后 API 与页面均回读同一记录。证据见 `apps/forge-objectstack/tests/page-acceptance/supply-inbound-browser-readback-20260916.json`。
