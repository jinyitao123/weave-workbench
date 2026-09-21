# 附加费用页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“附加费用”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4322`。

## 页面入口

- RISEMAP 附加费用：`https://risemap.cn/sales/additional-fees`
- Forge 附加费用：`http://localhost:4322/_console/apps/forge/page/page_sales_additional_fee`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 附加费用”，标题为“附加费用”，页面说明为“销售附加费用创建、审批、财务执行与来源单关联管理”。首屏指标包含客户承担有效金额、公司承担有效金额、待审批费用单、待开票 / 待付款。筛选项包含搜索、来源类型、承担类型、单据状态、财务状态。动作包含“上手指南”“刷新”“导出”“导出任务”“新增附加费用单”。页面有“附加费用单”“附加明细”切换，以及“全部”“草稿”“待审批”“已生效”“已作废”状态页签。表头列为：费用单号、来源单据、客户 / 项目、承担类型、费用项、含税金额、单据状态、财务状态、负责人、操作。

当前账号下列表为空，空态文案为“当前条件下暂无附加费用单”。本轮未在 RISEMAP 新增附加费用或办理审批、开票、付款。

## Forge 改造前差异

Forge 销售菜单此前没有单独的“附加费用”入口，也没有销售附加费用对象，不能承载来源单据、承担类型、费用项、单据状态和财务状态。

## Forge 本轮实现

- 新增 `forge_sales_additional_fee` 业务对象，承载费用单号、来源类型、销售订单/合同/发货单来源、客户、项目、承担类型、费用项、发生日期、含税金额、单据状态、财务状态和负责人。
- 新增业务工作区 `page_sales_additional_fee`，并按 RISEMAP 顺序把“附加费用”加入销售业务菜单，放在销售订单之后、收款流水之前。
- 页面按 RISEMAP 当前结构展示四个指标、五个筛选项、附加费用单/附加明细切换、五个状态页签、表头、空态和分页。
- “新增附加费用单”使用 ObjectStack Console 弹窗；提交前有二次确认，明确保存草稿只进入待开票或待付款财务状态，不自动审批或生成收付款。
- 本地验收库通过页面创建 `AF-FORGE-20260913-001`，来源 `SO-WF-20260909-001`，客户“苏州澄岳自动化装备有限公司”，承担类型“客户承担”，费用项“运输附加费”，含税金额 `¥1,800.00`，单据状态“草稿”，财务状态“待处理”。

## 分层说明

RISEMAP 当前无附加费用数据，本轮完成的是页面结构和本地草稿创建回读。审批、生效、作废、开票和付款承接仍需 RISEMAP 同材料可办理路径复核。

## 浏览器证据

- RISEMAP 附加费用：`risemap-sales-additional-fees.ax.txt`、`risemap-sales-additional-fees.png`。
- Forge 附加费用空态：`forge-sales-additional-fee-empty.ax.txt`、`forge-sales-additional-fee-empty.png`。
- Forge 附加费用二次确认：`forge-sales-additional-fee-dialog-confirm.ax.txt`、`forge-sales-additional-fee-dialog-confirm.png`。
- Forge 附加费用列表回读：`forge-sales-additional-fee-workspace.ax.txt`、`forge-sales-additional-fee-workspace.png`。

## 当前结论

“附加费用”已经补齐为销售菜单入口、业务对象、页面列表和本地新增草稿闭环。当前可验收范围是 RISEMAP 当前首屏结构和 Forge 本地草稿回读；审批及财务执行仍为待复核实现。

## 2026-09-20 逐页高标准复核

### 本轮实时对照

- RISEMAP 实时打开 `https://risemap.cn/sales/additional-fees`，当前仍为 0 条空态。首屏顺序为绿色标题区、四张指标卡、搜索与四个筛选、刷新/导出/导出任务/新增动作、单据/明细页签、状态页签和列表。
- Forge 实时打开 `http://localhost:3000/_console/apps/forge/page/page_sales_additional_fee`，使用当前登录会话成功读取数据；本轮未再出现此前的 `UNAUTHENTICATED`。
- 同视口目测确认了标题区高度与绿色层级、指标卡、工具栏密度、两排页签、表头及空态的对应关系。平台顶栏、左侧导航、按钮和字体细节继续采用 ObjectStack Console 统一语言。

### 本轮实现与控件证据

- 页面重排为与 RISEMAP 相同的办理顺序，并新增顶部插画、上手指南、真实 CSV 导出和导出任务说明；空数据时导出按钮禁用，不伪造导出结果。
- 补上 Bearer 会话头，页面 API 与 Console 当前登录态一致。
- “附加费用单”与“附加明细”现在渲染不同表头和空态；明细页按现有单据的单项费用真实展开，不再是仅改变选中样式的假页签。
- 列表复选框具有真实全选、单选和已选数量回读；当前 RISEMAP 与 Forge 都为空，因此本轮只验证了空态禁用条件，含数据时仍需补页面点击证据。
- 实际点击并确认“上手指南”“导出任务”“附加明细”“新增附加费用单”和标准日期选择器均有可理解反馈。
- 新增表单默认含税金额为 `0`；实际点击“下一步”后仍停留在表单，并显示“请填写费用单号、客户、费用项、发生日期和正数含税金额”。本轮没有提交或新增数据。

### 当前状态与剩余门禁

本轮完成了空态首屏、主要入口和关键表单阻断的实时双侧复核，但页面仍保持 `review_required`：RISEMAP 当前没有可办理数据，尚缺同一材料的创建、审批、生效、作废、开票/付款承接；含数据时的选择、筛选和导出；桌面/窄屏同宽截图及图像差分文件；同一 SQLite 停服重启回读；独立复核。上述证据齐全前不得称为整页验收通过。
