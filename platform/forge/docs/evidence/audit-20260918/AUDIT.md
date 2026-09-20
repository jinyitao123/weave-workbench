# Forge 供应链 ↔ RISEMAP 全量结构对照审计（42 页）

- 覆盖：到货检验 5 / 基础资料 7 / 采购管理 7 / 入库管理 6 / 库存管理 10 / 出库管理 7
- 有差异页面：41 / 42；差异点合计 201
- 证据：docs/evidence/audit-20260918/<页面>-risemap.png、-forge.png；原始事实 risemap-facts.json / forge-facts.json

## 差异分类统计

- forge-extra-button: 54
- risemap-only-button: 31
- filters: 28
- columns: 23
- icon-vs-text: 21
- tabs: 17
- row-actions: 14
- label-wording: 6
- kpis: 5
- hero-next: 1
- hero-chip: 1

## 逐页差异

### 到货通知（2 条）
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP ANO-2026-0002,查看到货通知 ANO-2026-0002[icon]；Forge 查看）
- 筛选控件文案不同：RISEMAP [通知单号 / 采购订单 / 供应商 / 物料 / 开始日期 / 结束日期] vs Forge [通知单号 / 采购订单 / 供应商 / 物料]

### 到货登记（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 11 列 vs Forge 10 列
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP [icon]；Forge 查看）

### 待检验库存（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 15 列 vs Forge 14 列
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP IQC-2026-0001,查看详情[icon]；Forge 查看检验单）

### 检验单（2 条）
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP [icon]；Forge 查看）
- 筛选控件文案不同：RISEMAP [搜索检验单号/物料名... / 开始日期 / 结束日期] vs Forge [搜索检验单号/物料名...]

### 检验规则（3 条）
- 页签不同：RISEMAP [] vs Forge [检验项目库 / 检验方案]
- 行操作形式不同：RISEMAP 5 个图标 / Forge 0 个（RISEMAP 查看[icon],编辑[icon],复制[icon],停用[icon],删除[icon]；Forge 查看,编辑,复制,停用,删除）
- 筛选控件文案不同：RISEMAP [搜索项目名称/编码...] vs Forge [搜索项目编码、名称...]

### 物料管理（9 条）
- 按钮文案不同：RISEMAP「导入/导出」→ Forge「导出」
- RISEMAP 有按钮「批量操作」，Forge 没有对应动作
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- RISEMAP 有按钮「品牌」，Forge 没有对应动作
- Forge 多出按钮「批量启用」
- Forge 多出按钮「批量停用」
- 页签不同：RISEMAP [] vs Forge [物料列表 / 商品图片]
- 列表列数不同：RISEMAP 20 列 vs Forge 10 列
- 筛选控件文案不同：RISEMAP [搜索物料名称、物料编码、物料条码、物料型号...] vs Forge [搜索物料名称、物料编码、物料条码、物料型号]

### 物料组合（5 条）
- RISEMAP 有按钮「批量」，Forge 没有对应动作
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「批量启用」
- Forge 多出按钮「批量停用」
- 列表列数不同：RISEMAP 12 列 vs Forge 11 列

### BOM管理（15 条）
- RISEMAP 有按钮「全部 1」，Forge 没有对应动作
- RISEMAP 有按钮「草稿 0」，Forge 没有对应动作
- RISEMAP 有按钮「待评审 0」，Forge 没有对应动作
- RISEMAP 有按钮「已生效 1」，Forge 没有对应动作
- RISEMAP 有按钮「已失效 0」，Forge 没有对应动作
- RISEMAP 有按钮「已归档 0」，Forge 没有对应动作
- RISEMAP 有按钮「标准」，Forge 没有对应动作
- RISEMAP 有按钮「项目」，Forge 没有对应动作
- RISEMAP 有按钮「导入/导出」，Forge 没有对应动作
- RISEMAP 有按钮「BOM对比」，Forge 没有对应动作
- RISEMAP 有按钮「新建BOM」，Forge 没有对应动作
- Forge 多出按钮「刷新」
- 页签不同：RISEMAP [] vs Forge [全部(2) / 草稿(0) / 待评审(0) / 已生效(2) / 已失效(0) / 已归档(0)]
- 列表列数不同：RISEMAP 13 列 vs Forge 12 列
- 行操作形式不同：RISEMAP 4 个图标 / Forge 0 个（RISEMAP [icon],查看[icon],复制[icon],失效[icon]；Forge 800 型控制柜项目 BOM,查看）

### 综合物料搜索（5 条）
- Forge 多出按钮「单件查询」
- Forge 多出按钮「批量清单分析」
- Forge 多出按钮「刷新」
- 页签不同：RISEMAP [] vs Forge [单件查询 / 批量清单分析]
- 筛选控件文案不同：RISEMAP [] vs Forge [搜索编码、名称、型号、品牌、供应商、物料组合、SN码、批次号...]

### 供应商管理（9 条）
- 按钮文案不同：RISEMAP「导入/导出」→ Forge「导出」
- RISEMAP 有按钮「批量」，Forge 没有对应动作
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「批量启用」
- Forge 多出按钮「批量停用」
- 页签不同：RISEMAP [] vs Forge [供应商列表 / 资质管理]
- 列表列数不同：RISEMAP 29 列 vs Forge 10 列
- 行操作形式不同：RISEMAP 4 个图标 / Forge 0 个（RISEMAP [icon],查看[icon],编辑[icon],删除[icon]；Forge 编辑,停用,删除）
- 筛选控件文案不同：RISEMAP [搜索供应商名称/联系人/联系电话/邮箱/负责人...] vs Forge [搜索供应商名称、编号、联系人、联系电话、邮箱]

### 产品实例追溯（4 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 页签不同：RISEMAP [] vs Forge [物料编码 / 批次码 / 产品实例]
- 列表列数不同：RISEMAP 13 列 vs Forge 8 列
- 筛选控件文案不同：RISEMAP [搜索追溯码、外部SN、物料编码、SKU编码、SKU条码、物料条码...] vs Forge [搜索物料编码、名称、型号或条码]

### 仓库管理（6 条）
- Forge 多出按钮「新增仓库」
- Forge 多出按钮「导出」
- Forge 多出按钮「导入/导出任务」
- Forge 多出按钮「刷新」
- 列表列数不同：RISEMAP 0 列 vs Forge 8 列
- 筛选控件文案不同：RISEMAP [] vs Forge [搜索仓库名称、仓库编码、仓库地址]

### 采购发票（5 条）
- RISEMAP 有按钮「全部」，Forge 没有对应动作
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「待登记入库单 11」
- 页签不同：RISEMAP [] vs Forge [全部 / 正常 / 已作废 / 已红冲]
- 筛选控件文案不同：RISEMAP [搜索发票号 / 供应商 / 订单号] vs Forge [搜索发票号、登记编号、供应商或订单]

### 采购申请（7 条）
- 按钮文案不同：RISEMAP「导入/导出」→ Forge「导出」
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「批量导入」
- 页签不同：RISEMAP [] vs Forge [申请列表 / 物料明细]
- 列表列数不同：RISEMAP 18 列 vs Forge 17 列
- 行操作形式不同：RISEMAP 2 个图标 / Forge 0 个（RISEMAP 查看详情[icon],关闭[icon]；Forge 查看,进入采购待办）
- 筛选控件文案不同：RISEMAP [搜索申请编号、标题... / 开始日期 / 结束日期] vs Forge [搜索申请编号、标题、项目、客户或供应商]

### 采购待办池（13 条）
- RISEMAP 有按钮「智能拆分」，Forge 没有对应动作
- RISEMAP 有按钮「批量指定供应商」，Forge 没有对应动作
- RISEMAP 有按钮「批量暂缓」，Forge 没有对应动作
- RISEMAP 有按钮「批量关闭」，Forge 没有对应动作
- 按钮文案不同：RISEMAP「导入/导出任务」→ Forge「导出」
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「指定供应商」
- Forge 多出按钮「暂缓」
- Forge 多出按钮「关闭」
- 页签不同：RISEMAP [] vs Forge [待办列表 / 分组视图]
- 列表列数不同：RISEMAP 25 列 vs Forge 24 列
- 行操作形式不同：RISEMAP 2 个图标 / Forge 0 个（RISEMAP 指定供应商[icon],[icon]；Forge PR-1789654276771）
- 筛选控件文案不同：RISEMAP [单号 / 物料编码 / 名称 / 型号 / 品牌 / 开始日期 / 结束日期] vs Forge [单号 / 物料编码 / 名称 / 型号 / 规格]

### 询价管理（6 条）
- 按钮文案不同：RISEMAP「导入/导出任务」→ Forge「导出」
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- hero「下一步操作」磁贴：RISEMAP 有 / Forge 无
- 列表列数不同：RISEMAP 10 列 vs Forge 9 列
- 行操作形式不同：RISEMAP 5 个图标 / Forge 0 个（RISEMAP 查看详情[icon],关注[icon],供应商报价链接[icon],新窗口打开[icon],删除[icon]；Forge RFQ-2026-0001,办理）
- 筛选控件文案不同：RISEMAP [搜索询价单号/标题/项目...] vs Forge [搜索询价单号、标题、来源或采购员]

### 采购订单（14 条）
- RISEMAP 有按钮「订单明细0」，Forge 没有对应动作
- 按钮文案不同：RISEMAP「导入/导出」→ Forge「导出」
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- RISEMAP 有按钮「筛选供应商...」，Forge 没有对应动作
- RISEMAP 有按钮「开票」，Forge 没有对应动作
- RISEMAP 有按钮「入库」，Forge 没有对应动作
- RISEMAP 有按钮「付款」，Forge 没有对应动作
- Forge 多出按钮「到货通知」
- Forge 多出按钮「订单明细」
- Forge 多出按钮「恢复全部」
- 页签不同：RISEMAP [] vs Forge [订单列表 / 订单明细]
- 列表列数不同：RISEMAP 27 列 vs Forge 25 列
- 行操作形式不同：RISEMAP 3 个图标 / Forge 0 个（RISEMAP 关注[icon],查看详情[icon],复制开单[icon]；Forge PO-RM-20260913210506-001,查看,到货登记）
- 筛选控件文案不同：RISEMAP [搜索订单号...] vs Forge [搜索订单号、供应商、BOM 或备注]

### 采购退换货（4 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- RISEMAP 有按钮「全部」，Forge 没有对应动作
- 页签不同：RISEMAP [] vs Forge [全部 / 退货退款 / 换货补货]
- 列表列数不同：RISEMAP 13 列 vs Forge 12 列

### 供应商价格本（12 条）
- Forge 多出按钮「导出」
- Forge 多出按钮「导入/导出任务」
- Forge 多出按钮「刷新」
- Forge 多出按钮「新建价格本」
- Forge 多出按钮「草稿」
- Forge 多出按钮「生效中」
- Forge 多出按钮「已过期」
- Forge 多出按钮「已废弃」
- 页签不同：RISEMAP [] vs Forge [全部 / 草稿 / 生效中 / 已过期 / 已废弃]
- 列表列数不同：RISEMAP 0 列 vs Forge 11 列
- 指标卡数量不同：RISEMAP 0 / Forge 4
- 筛选控件文案不同：RISEMAP [] vs Forge [搜索价格本名称、编号或供应商]

### 全部入库单（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP 查看详情[icon]；Forge 查看详情）
- 筛选控件文案不同：RISEMAP [搜索入库单号/批次号...] vs Forge [搜索入库单号、批次号、供应商或仓库]

### 采购入库 — 无结构差异

### 生产入库（5 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「从组装单办理入库」
- hero「当前环节」提示：RISEMAP 有 / Forge 无
- 指标卡数量不同：RISEMAP 0 / Forge 3
- 筛选控件文案不同：RISEMAP [搜索入库单号/批次号...] vs Forge [搜索入库单号、批次号、组装单或成品]

### 其他入库（1 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮

### 期初入库（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 13 列 vs Forge 12 列
- 行操作形式不同：RISEMAP 2 个图标 / Forge 0 个（RISEMAP 查看详情[icon],删除[icon]；Forge 查看详情,删除）

### 入库明细（2 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 筛选控件文案不同：RISEMAP [入库单号关键字... / 物料编码/名称/规格 / 开始日期 / 结束日期] vs Forge [入库单号关键字... / 物料编码/名称/规格]

### 库存总览（11 条）
- Forge 多出按钮「总览」
- Forge 多出按钮「物料库存」
- Forge 多出按钮「在途库存 11」
- Forge 多出按钮「分类汇总」
- Forge 多出按钮「仓库视图」
- Forge 多出按钮「调拨管理查看仓库间调拨与借出归还」
- Forge 多出按钮「报损管理查看报损扣减与库存影响」
- Forge 多出按钮「库存流水追溯最近 466 条库存变动」
- Forge 多出按钮「采购在途13 · ¥102,000.00」
- 页签不同：RISEMAP [] vs Forge [总览 / 物料库存 / 在途库存 11 / 分类汇总 / 仓库视图]
- 指标卡数量不同：RISEMAP 0 / Forge 8

### 不合格处理（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 11 列 vs Forge 10 列
- 筛选控件文案不同：RISEMAP [搜索 NCR 单号 / 物料...] vs Forge [搜索 NCR、来源单据、物料或供应商]

### 处置执行中心（8 条）
- RISEMAP 有按钮「全部(0)」，Forge 没有对应动作
- RISEMAP 有按钮「待执行(0)」，Forge 没有对应动作
- RISEMAP 有按钮「已完成(0)」，Forge 没有对应动作
- RISEMAP 有按钮「刷新」，Forge 没有对应动作
- Forge 多出按钮「待执行 (3)」
- Forge 多出按钮「已完成 (18)」
- 页签不同：RISEMAP [] vs Forge [全部 (21) / 待执行 (3) / 执行中 (0) / 已完成 (18) / 执行异常 (0)]
- 筛选控件文案不同：RISEMAP [搜索执行单号 / NCR / 来源单号 / 物料] vs Forge [搜索执行单号、来源业务或物料]

### 库存流水（5 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- Forge 多出按钮「库存流水」
- 页签不同：RISEMAP [] vs Forge [库存流水 / 报表]
- 列表列数不同：RISEMAP 19 列 vs Forge 18 列
- 筛选控件文案不同：RISEMAP [搜索物料名称/编码/型号... / 事务号/流水号 / 批次/SN 码 / 开始日期] vs Forge [搜索物料名称/编码/型号... / 事务号/流水号 / 批次/SN 码]

### 库存锁定（3 条）
- 页签不同：RISEMAP [] vs Forge [业务锁库 / 手动锁库 / 物料锁定概况 / 锁库操作日志]
- 指标卡数量不同：RISEMAP 0 / Forge 4
- 筛选控件文案不同：RISEMAP [搜索物料、锁定单号或来源单号...] vs Forge [搜索单号、物料、仓库或来源]

### 库存盘点（3 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 15 列 vs Forge 14 列
- 筛选控件文案不同：RISEMAP [搜索盘点单号/名称/仓库...] vs Forge [搜索盘点编号、名称、物料或仓库]

### 调拨与借出（2 条）
- 「刷新」RISEMAP 是图标按钮，Forge 是文字按钮
- 列表列数不同：RISEMAP 13 列 vs Forge 11 列

### 库存预警（12 条）
- Forge 多出按钮「刷新」
- Forge 多出按钮「物料预警配置」
- Forge 多出按钮「预警设置」
- Forge 多出按钮「库存预警低库存、超储与呆滞提醒1」
- Forge 多出按钮「交期预警暂无预警」
- Forge 多出按钮「低库存」
- Forge 多出按钮「超储预警」
- Forge 多出按钮「呆滞库存」
- 页签不同：RISEMAP [] vs Forge [全部 / 低库存 / 超储预警 / 呆滞库存]
- 列表列数不同：RISEMAP 0 列 vs Forge 9 列
- 指标卡数量不同：RISEMAP 0 / Forge 4
- 筛选控件文案不同：RISEMAP [] vs Forge [搜索物料或仓库]

### 报损单（1 条）
- 筛选控件文案不同：RISEMAP [搜索报损单号...] vs Forge [搜索报损单号、仓库或类型]

### SN码管理（1 条）
- 列表列数不同：RISEMAP 8 列 vs Forge 9 列

### 出库单列表（1 条）
- 筛选控件文案不同：RISEMAP [搜索出库单号、客户、发货单号...] vs Forge [搜索出库单号、关联单号、往来单位、物料...]

### 生产出库（2 条）
- RISEMAP 有按钮「出库类型」，Forge 没有对应动作
- 筛选控件文案不同：RISEMAP [搜索出库单号、客户、发货单号...] vs Forge [搜索出库单号、客户、关联单号...]

### 其他出库（1 条）
- Forge 多出按钮「导出 ▾」

### 销售直接出库（1 条）
- Forge 多出按钮「导出 ▾」

### 待出库发货单（3 条）
- 列名/顺序不同：RISEMAP [/发货单号/客户单号/客户/收货人/收货地址/含税金额/出库进度/状态/日期/操作] vs Forge [发货单号/客户单号/客户/收货人/收货地址/含税金额/出库进度/状态/日期/负责人/操作]
- 行操作形式不同：RISEMAP 1 个图标 / Forge 0 个（RISEMAP 查看详情[icon],去发货；Forge 无）
- 筛选控件文案不同：RISEMAP [搜索发货单号、客户...] vs Forge [搜索发货单号、订单、客户、收货人、地址...]

### 采购退换货出库（2 条）
- Forge 多出按钮「导出 ▾」
- 列表列数不同：RISEMAP 8 列 vs Forge 9 列

### 出库明细（1 条）
- 筛选控件文案不同：RISEMAP [搜索出库单号... / 物料名称/编码/型号... / 客户名称... / 物流单号...] vs Forge [搜索出库单号... / 物料名称/编码... / 客户名称... / 物流单号...]
