# 收款流水页面合同（RISEMAP 结构验收）

本轮范围：销售业务下的“收款流水”入口。  
对照日期：2026-09-13。  
验收库：`/tmp/forge-sales-shipment-final.sqlite`，服务端口 `4321`。

## 页面入口

- RISEMAP 收款流水：`https://risemap.cn/sales/collection-flow`
- Forge 收款流水：`http://localhost:4321/_console/apps/forge/page/page_sales_collection_flow`

证据保存目录：`docs/references/risemap-capture/live/20260913-sales-full/`

## RISEMAP 当前事实

RISEMAP 当前页面属于“销售业务 / 收款流水”，标题为“收款流水”，页面说明为“展示收款资金流水 · 手动分配到销售订单 · 核销前可解绑 · 分配后刷新订单回款进度”。首屏指标包含收款流水总额、已分配金额、未分配金额和待分配。状态页签包含“全部”“待分配”“部分分配”“已分配”。筛选项包含搜索流水号或订单、按对方名称筛选、按金额筛选、全部客户和日期范围。表头列为：流水号、往来单位/客户、收款日期、方式、收款账户、收款金额、已分配 / 未分配、状态、操作。

当前账号下列表为空，显示“暂无收款流水”。本轮没有在 RISEMAP 登记到账或分配收款，因此不能把分配成功、取消分配或撤销到账写成 RISEMAP 已观察事实。

## Forge 改造前差异

Forge 销售菜单中的“收款流水”此前指向销售占位页，不能按 RISEMAP 当前页展示资金流水指标、状态页签、筛选区和列表列，也不能从销售侧进入收款分配办理。

## Forge 本轮实现

- 新增业务工作区 `page_sales_collection_flow`，并把销售业务下的“收款流水”入口指向该页面。
- 页面读取 `forge_cash_receipt`、`forge_collection_allocation`、`forge_accounts_receivable`、`forge_sales_order`、`forge_sales_invoice`、`forge_customer`、`forge_fund_account` 和 `sys_user`。
- 首屏对齐 RISEMAP 的指标、四个状态页签、搜索/对方/金额/日期筛选和表头列。
- 有收款流水时可在销售侧执行“分配到订单”；生成待审核核销记录后，核销前可“取消分配”。
- “撤销到账”属于破坏性财务动作，使用二次确认弹窗，明确显示会撤销实际到账并从原资金账户扣回同额余额。
- 日期筛选和业务选择使用 ObjectStack Console 共享组件，不使用浏览器原生下拉或日期选择器。

## 分层说明

RISEMAP 当前页面没有可办理数据，本轮只能完成入口、首屏结构、筛选、表头和空态对照。Forge 的分配、取消分配和撤销到账来自既有财务动作能力，是本地可写执行扩展；后续需要在 RISEMAP 出现可办理流水后做同材料对照。

## 浏览器证据

- RISEMAP 收款流水：`risemap-sales-collection-flow.ax.txt`、`risemap-sales-collection-flow.png`。
- Forge 收款流水：`forge-sales-collection-flow.ax.txt`、`forge-sales-collection-flow.png`。

## 当前结论

“收款流水”已经从销售占位入口推进为可对照的业务工作区。当前可验收范围是 RISEMAP 已观察到的收款流水首屏结构、指标、页签、筛选、表头和空态；收款登记、分配、取消分配和撤销到账仍需在有 RISEMAP 同材料可办理数据后复核。

## 2026-09-20 逐页高标准复核

### 本轮实时对照

- RISEMAP 实时打开 `https://risemap.cn/sales/collection-flow`，当前仍为 0 条空态。确认绿色标题区、四张指标卡、四个状态页签、右侧三项列表工具、五类筛选、九列表头和“暂无收款流水”。
- Forge 实时打开 `http://localhost:3000/_console/apps/forge/page/page_sales_collection_flow`，当前持久库读取 8 条已分配流水，合计 `¥502,400.00`，未分配 `¥0.00`。这些是 Forge 当前库数据，不是 RISEMAP 同材料。
- 先对照同视口截图再修改。Forge 改造前缺少绿色标题区，标题右侧放置了 RISEMAP 没有的跨页面按钮，筛选折叠层级、页签顺序和文字语义也与当前 RISEMAP 不同。

### 本轮实现与控件证据

- 页面现按 RISEMAP 顺序呈现绿色标题区、四张指标卡、状态页签、列表工具、同排筛选和流水表；标题说明、指标名称与辅助文案改回 RISEMAP 当前可见文字。
- “待审核”是 Forge 核销扩展状态，仅在确有待审核数据时显示，不再以 0 条页签干扰 RISEMAP 四页签基线。
- 搜索、对方名称、精确金额、客户和起止日期均为直接可用筛选；日期使用 Console 标准日期面板。
- 实际切换“已分配”，搜索 `CR-PRE-API-20260910-001` 后列表从 8 条缩为 1 条；点击重置恢复 8 条；实际打开开始日期面板；点击第一条“查看”成功进入真实收款流水详情页，显示金额、客户、分配状态、对方流水号和负责人。
- 本轮只做只读走查，没有执行分配、审核、取消分配或撤销到账。

### 当前状态与剩余门禁

本轮完成首屏视觉结构和只读控件的实时双侧复核，但仍保持 `review_required`。RISEMAP 为空而 Forge 有 8 条历史流水，尚不能满足同一材料双侧办理；分配/解绑/撤销的 RISEMAP 当前行为、桌面与窄屏同宽截图及图像差分、同一 SQLite 本轮停服重启回读和独立复核仍待完成。
