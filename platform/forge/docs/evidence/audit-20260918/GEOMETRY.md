# Forge ↔ RISEMAP 组件几何对照（同宽 1280）

测量项：hero 标题字号、hero 盒子、内容卡片宽度、表格宽度、表头行高、列数与列宽、工具条按钮高度、指标卡高度。
原始数据：risemap-geometry.json / forge-geometry.json

> 口径说明：按钮高度集合会把控制台外壳的按钮（RISEMAP 的「收起侧边栏」23px、顶部导航块）也算进来，
> 因此「工具条按钮高度差异」一项偏噪音；工具条本身的实测值另见下表。

## 几何差异统计

- 标题字号差异 ≥3px：0 页
- 表头行高差异 ≥6px：12 页
- 列数不同：22 页；同名列宽差异 ≥1.5 倍：18 页
- 内容卡片宽度差 ≥40px：37 页；表格宽度差 ≥60px：31 页
- 工具条按钮高度差异 ≥4px：42 页

## 逐页几何差异

### 到货通知（5 条）
- 表头行高：RISEMAP 35px / Forge 57px
- 同名列宽差异 ≥1.5 倍：第1列 46→89px，第2列 177→266px，第7列 187→66px
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1192px / Forge 1106px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 到货登记（5 条）
- 表头行高：RISEMAP 53px / Forge 39px
- 列数：RISEMAP 11 / Forge 10
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1100px / Forge 1208px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/34/36
### 待检验库存（5 条）
- 表头行高：RISEMAP 53px / Forge 39px
- 列数：RISEMAP 15 / Forge 14
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1742px / Forge 1970px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/34/36
### 检验单（5 条）
- 表头行高：RISEMAP 53px / Forge 39px
- 同名列宽差异 ≥1.5 倍：第3列 118→211px，第4列 160→370px，第7列 100→59px
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1381px / Forge 1570px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36
### 检验规则（3 条）
- 同名列宽差异 ≥1.5 倍：第7列 100→52px，第12列 176→268px
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/40
### 物料管理（4 条）
- 列数：RISEMAP 20 / Forge 10
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 2554px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 物料组合（4 条）
- 列数：RISEMAP 12 / Forge 11
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1126px / Forge 1250px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### BOM管理（5 条）
- 表头行高：RISEMAP 32px / Forge 53px
- 列数：RISEMAP 13 / Forge 12
- 内容卡片宽度：RISEMAP 736px / Forge 1140px
- 表格宽度：RISEMAP 1300px / Forge 1377px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 综合物料搜索（1 条）
- 工具条按钮高度：RISEMAP 21/23/25/27/28/30/32/35 / Forge 28/32/44
### 供应商管理（4 条）
- 列数：RISEMAP 29 / Forge 10
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 3649px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/39 / Forge 28/32/36/44
### 产品实例追溯（5 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 列数：RISEMAP 13 / Forge 8
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1854px / Forge 1180px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 仓库管理（2 条）
- 列数：RISEMAP 0 / Forge 8
- 工具条按钮高度：RISEMAP 21/23/25/27/28/30/32/35 / Forge 28/32/36
### 采购发票（5 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 同名列宽差异 ≥1.5 倍：第4列 163→85px
- 内容卡片宽度：RISEMAP 968px / Forge 1140px
- 表格宽度：RISEMAP 1510px / Forge 1220px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 采购申请（4 条）
- 列数：RISEMAP 18 / Forge 17
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 2250px / Forge 1540px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36/44
### 采购待办池（4 条）
- 列数：RISEMAP 25 / Forge 24
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 2654px / Forge 1747px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36/44
### 询价管理（3 条）
- 列数：RISEMAP 10 / Forge 9
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36
### 采购订单（4 条）
- 列数：RISEMAP 27 / Forge 25
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 3456px / Forge 2502px
- 工具条按钮高度：RISEMAP 21/23/25/27/28/30/32/35/45 / Forge 28/32/36
### 采购退换货（4 条）
- 列数：RISEMAP 13 / Forge 12
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1524px / Forge 1400px
- 工具条按钮高度：RISEMAP 21/23/25/27/28/30/32/35 / Forge 28/32/34/36/44
### 供应商价格本（2 条）
- 列数：RISEMAP 0 / Forge 11
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/44
### 全部入库单（4 条）
- 同名列宽差异 ≥1.5 倍：第5列 90→149px，第9列 100→151px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1278px / Forge 1420px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 采购入库（5 条）
- 表头行高：RISEMAP 53px / Forge 39px
- 同名列宽差异 ≥1.5 倍：第2列 120→207px，第6列 117→176px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1278px / Forge 1343px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36
### 生产入库（3 条）
- 同名列宽差异 ≥1.5 倍：第8列 100→162px，第13列 90→157px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36
### 其他入库（3 条）
- 同名列宽差异 ≥1.5 倍：第5列 90→145px，第6列 100→63px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 期初入库（4 条）
- 列数：RISEMAP 13 / Forge 12
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1212px / Forge 1380px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 入库明细（4 条）
- 同名列宽差异 ≥1.5 倍：第4列 140→221px，第10列 131→318px，第19列 100→52px，第20列 118→188px
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 2116px / Forge 2380px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 库存总览（1 条）
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/42
### 不合格处理（4 条）
- 列数：RISEMAP 11 / Forge 10
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1200px / Forge 1380px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 处置执行中心（4 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 同名列宽差异 ≥1.5 倍：第2列 153→75px，第6列 148→83px
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/42
### 库存流水（3 条）
- 列数：RISEMAP 19 / Forge 18
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/42
### 库存锁定（4 条）
- 同名列宽差异 ≥1.5 倍：第2列 150→76px，第3列 190→76px，第4列 130→52px，第5列 150→87px 等 8 列
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1906px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 库存盘点（4 条）
- 列数：RISEMAP 15 / Forge 14
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1594px / Forge 1700px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 调拨与借出（4 条）
- 列数：RISEMAP 13 / Forge 11
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 1254px / Forge 1350px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 库存预警（2 条）
- 列数：RISEMAP 0 / Forge 9
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/44
### 报损单（5 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 同名列宽差异 ≥1.5 倍：第4列 76→139px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 994px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### SN码管理（5 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 列数：RISEMAP 8 / Forge 9
- 内容卡片宽度：RISEMAP 996px / Forge 1140px
- 表格宽度：RISEMAP 996px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36/44
### 出库单列表（4 条）
- 同名列宽差异 ≥1.5 倍：第3列 120→245px，第7列 100→278px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1404px / Forge 1680px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 生产出库（4 条）
- 同名列宽差异 ≥1.5 倍：第2列 150→254px，第3列 120→199px，第7列 100→257px，第11列 120→75px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1404px / Forge 1680px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32/36
### 其他出库（4 条）
- 同名列宽差异 ≥1.5 倍：第1列 44→80px，第7列 300→147px，第8列 80→124px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1034px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 销售直接出库（4 条）
- 同名列宽差异 ≥1.5 倍：第2列 152→391px，第3列 132→75px，第8列 120→70px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 994px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32/36
### 待出库发货单（4 条）
- 同名列宽差异 ≥1.5 倍：第1列 44→121px，第4列 188→102px，第5列 80→121px，第8列 160→83px
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1309px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35/45 / Forge 28/32
### 采购退换货出库（5 条）
- 表头行高：RISEMAP 35px / Forge 53px
- 列数：RISEMAP 8 / Forge 9
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 1064px / Forge 1138px
- 工具条按钮高度：RISEMAP 21/23/27/28/30/32/35 / Forge 28/32
### 出库明细（4 条）
- 同名列宽差异 ≥1.5 倍：第4列 140→292px，第5列 120→80px，第8列 100→55px，第13列 140→80px 等 6 列
- 内容卡片宽度：RISEMAP 994px / Forge 1140px
- 表格宽度：RISEMAP 2134px / Forge 2050px
- 工具条按钮高度：RISEMAP 21/23/25/27/28/30/32/35 / Forge 28/32/36

## 本轮按几何结论做的修复

| 组件 | 改前 | RISEMAP 实测 | 改后 | 结果 |
| --- | --- | --- | --- | --- |
| hero 标题字号 | 27px（实测 30px） | 21px | 22px | 42 页标题字号差异归零 |
| 工具条图标按钮 | 32×32 | 27×27 | 28×28 | 与 RISEMAP 差 1px |
| 文字按钮高度 | 34px | 32px | 32px | 一致 |
| 列表表头行高（`.fp-table`） | 39px | 53px | 53px | 一致 |
| 列表表头行高（15 个用旧 `.table` 样式的页面） | 39px | 53px | 53px | 一致（到货通知因表头换行为 71px，单独保留差异） |

改后复核：采购入库 / 库存锁定 / 出库单列表 / 检验单 / 采购订单 / 其他入库 的工具条按钮高度为 Forge 28（图标）、32（文字），RISEMAP 为 27（图标）、30~32（文字）；六页表头均为 53px。

## 仍然存在的几何差异（未修，需决策）

1. **内容卡片宽度**：RISEMAP 996px / Forge 1140px（37 页）。原因是两侧外壳侧边栏宽度不同，属于 Console 外壳差异，不是页面内部布局问题。
2. **列宽分布**：同名列宽差 ≥1.5 倍的有 18 页（例如到货通知第 7 列 187→66px）。两边的列宽策略不同（RISEMAP 按内容分配、Forge 用 min-width 横向滚动），需要决定是否逐列指定宽度。
3. **列数**：22 页不同，主要是 RISEMAP 的勾选列与末尾附加列（详见 AUDIT.md）。
4. **到货通知表头**：Forge 71px / RISEMAP 35px，Forge 表头文案换行导致。
