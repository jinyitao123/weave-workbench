# Forge 采购到货、检验与入库切片

## 结果

这是一份早期、待复核的检验与入库切片。它曾把采购订单审批后的待到货通知继续推进为“登记到货 → 来料检验 → 合格数量采购入库 → 库存余额与流水”，并以单行 PLC 订单验证到货 2、合格 1、入库 1。

2026-09-10 的 RISEMAP 同材料复核已确认，采购订单审批后产生的是一张含多条物料的订单级到货通知。当前实现已迁移通知模型，并已在 `docs/forge-multiline-arrival-slice.md` 完成多物料到货登记验收。当前主线已在 `docs/forge-multiline-inspection-slice.md` 与 `docs/forge-multiline-inbound-slice.md` 完成逐物料检验和多物料采购入库重做。本文件只保留早期实验记录。

## 已实现规则

- 以下规则属于旧单物料实验，不是当前订单级通知的已证明行为。
- 到货登记不得超过通知剩余数量，并自动生成一张单物料待检验单。
- 检验完成时登记合格数量，不合格数量按到货总数扣减计算。
- 采购入库只接收检验合格数量，同一检验单只能生成一张有效入库单。
- 入库按采购明细含税单价增加库存金额，重算移动平均成本，并生成来源对象为采购入库单的库存流水。
- 到货、检验、合格和入库数量分别回写采购订单明细；订单只有在全部采购数量入库后才进入完成状态。

## 验收证据

API 验收覆盖 5 项业务检查，包括完整到货建检验单、重复到货阻断、检验数量边界、部分合格只入合格量、重复入库阻断。完整停服并从同一 SQLite 文件重启后，到货登记、部分合格检验单、采购入库单、库存余额、来源流水及采购订单累计量均以原 ID 精确回读。

页面检查确认三个新入口和关键结果可见。证据为 [到货登记](references/risemap-capture/deep/supply-chain/arrival-inspection/rm-006/807-forge-purchase-receipt-list.png)、[采购检验单](references/risemap-capture/deep/supply-chain/arrival-inspection/rm-008/808-forge-purchase-inspection-list.png) 和 [采购入库](references/risemap-capture/deep/supply-chain/inbound/rm-025/806-forge-purchase-inbound-list.png)。

## 保留边界

多物料到货登记、逐物料检验和多物料采购入库已按当前订单级通知模型重新实现，详见 `docs/forge-multiline-arrival-slice.md`、`docs/forge-multiline-inspection-slice.md` 与 `docs/forge-multiline-inbound-slice.md`。新主线收窄了旧实验的应付触发假设，入库只落库存，应付与进项发票继续待 RISEMAP 同材料复核。抽检方案、免检规则、批次追溯细化、供应商不合格处置和采购退货仍未完成。当前单据和累计量采用顺序写入，尚无原子回滚保证。
