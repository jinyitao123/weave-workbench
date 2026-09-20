# Forge 销售发货计划切片

## 结果

Forge 已实现“执行中销售订单 → 分批创建销售发货单和发货明细 → 读取持久库存后确认出库 → 扣减余额并生成流水 → 回写发货与订单进度”。串联验收从 2 台控制柜订单建立 1 台发货单，期初入库累计库存 3 后出库 1，库存降到 2，库存金额从 174000 降到 116000。最终发货单为已出库 1/1，订单为部分发货，已发货数量 1、金额 128000。

这个切片复制客户发货计划和库存满足后的销售出库执行。RISEMAP 实测证明两者是上下游单据：库存为 0 时可在警告后继续创建销售发货单，但供应链“去发货”会提示先完成期初入库；完成期初入库并具备可用库存后，才允许客户自取发货并生成出库单。

## RISEMAP 实测契约

| 规则 | 实测结果 | Forge 对照 |
| --- | --- | --- |
| 分批建单 | SO-2026-0001 订单 2 台，本次可填 1 台 | 动作接收本次数量，检查已有未取消发货明细的占用量 |
| 库存不足 | 库存0、可用0时弹出警告，可继续创建发货单 | 建发货单不读写库存 |
| 发货单金额 | 1 台显示 128000，采用明细折前含税单价，不是整单 5% 折扣后比例金额 121600 | 按 `taxed_unit_price × quantity` 写入发货单和明细 |
| 出库进度 | DN-2026-0001 创建后为待发货、0/1 台、关联出库单0 | 发货单和明细 `outbound_quantity=0`，订单已发货值不变 |
| 实际出库门槛 | 待出库队列可见该发货单；无期初库存时出库创建被阻断；补录期初库存后表单已有库存，但最终确认仍被同一门槛阻断 | Forge 从仓库与 SKU 的持久余额读取可用量；无余额或不足时拒绝，成功后扣减余额、生成来源流水并回写发货单、发货明细和订单 |

RISEMAP 证据为 `2098` 至 `2107`，包括发货表单、数量1、库存警告、发货单终态、待出库队列、出库表单和期初库存阻断。

## Forge 动作与验收

`sales_order_create_shipment` 仅在订单执行中或部分发货时显示。当前实现要求订单只有一条物料明细，收集发货单号、日期、收货人、电话、地址和本次数量。数量不得超过订单数量减去未取消发货明细已占用的数量。

`sales-shipment.integration.mjs` 的 3 项计划检查已通过。`sales-outbound.integration.mjs` 另验证无库存余额阻断、真实余额与金额扣减、来源流水、发货与订单回写及重复出库阻断。报告分别保存于 `.objectstack/acceptance/sales-shipment-report.json` 和 `.objectstack/acceptance/sales-outbound-report.json`。

内置浏览器已实际打开 Forge 订单、发货单和出库结果。最新同库串联与重启后，销售出库列表直接显示校验时可用库存 3、出库前 3、出库后 2 和库存金额 58000；销项发票与应收账款列表均显示折后金额 121600。历史页面证据保留为 [出库后发货单回写](references/risemap-capture/deep/supply-chain/outbound/rm-043/800-forge-iab-shipment-outbounded.png)、[旧版销售出库单列表](references/risemap-capture/deep/supply-chain/outbound/rm-043/801-forge-iab-sales-outbound-list.png) 和 [旧版销售出库单详情](references/risemap-capture/deep/supply-chain/outbound/rm-043/802-forge-iab-sales-outbound-detail.png)；本轮证据为 [库存驱动的销售出库](references/risemap-capture/deep/supply-chain/outbound/rm-043/803-forge-iab-inventory-backed-outbound-list.png)、[销项发票](references/risemap-capture/deep/supply-chain/outbound/rm-043/804-forge-iab-sales-invoice-list.png) 与 [应收账款](references/risemap-capture/deep/supply-chain/outbound/rm-043/805-forge-iab-accounts-receivable-list.png)。

当前动作在 ObjectStack 17.3.0 中不能把单据、余额、流水和累计回写包在 `ctx.api.transaction` 内：开发运行时的审计写入会等待至 30 秒超时。当前使用顺序写入，因此中间写入失败时的补偿或原子性仍是未闭合风险。多明细分配、多订单合并发货、发货单取消、并发库存预占与重试幂等仍在后续切片处理。

## 分批交付纠错与浏览器验收

第二张发货单首次真实出库时，订单头进入已发货且已发货金额累计为 256000，但订单明细的已发货数量仍停在 1。原因是出库动作错误地从发货单明细读取 `shipped_quantity`。修正后，动作按关联订单明细的当前值累计；两张各 1 台的发货单完成出库后，订单明细为已发货 2/2，允许第二张 121600 的折后销项发票，第三次开票继续被“超过已发货未开票数量”阻断。

独立端口 4340 和独立 SQLite 上的接口验收已经覆盖两次真实建发货单、出库和开票动作，并通过完整停服重启回读。随后从第二批办理前的同一数据库基线开始，内置真实浏览器依次提交 `UI-DN-2-20260909`、`UI-OUT-2-20260909` 和 `UI-INV-2-20260909`。页面确认订单已发货、发货单数 2、已发货金额 256000、已开票金额 243200；发票与应收列表各有两笔 121600，库存余额为 1、可用库存为 1、库存金额为 58000。再次完整停服重启后，接口回读和库存页面均保持相同结果。

这里仍只证明 Forge 的分批交付与开票行为。RISEMAP 同一材料的成功出库、开票和收款仍未跑通，因此发货金额采用折前含税单价而发票采用折后分摊价的差异继续保留，不能写成对照通过；收款及应收核销也尚未在 Forge 实现。
