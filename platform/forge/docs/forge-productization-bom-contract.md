# BOM 页面产品化契约 v0.1

状态：Forge 页面实现与验收通过，RISEMAP 同材料对照待复核。消费基线：`4f8f59a`。本文件细化 `forge-productization-plan.md` 的 P0。

## 用户任务

工程人员找到当前项目的 BOM，核对产品与版本、检查物料结构、提交或处理评审，并按生产数量查看缺料。用户始终知道正在处理哪个版本，以及结果是否已经保存。

## 已观察依据

- RISEMAP 基础资料：`docs/references/risemap-capture/deep/data-pass/bom/dp014/2091-dp014-persisted-detail.png`。
- RISEMAP 已保存结构：同目录 `2092-dp014-persisted-structure.png`。
- RISEMAP 列表、页签：`docs/references/risemap-capture/deep/supply-chain/master-data/rm-012/474-rm-012-bom-list-pass1.png` 及 `479` 至 `484` 的结构、缺料、版本、引用、日志、图纸截图。
- Forge 现有实现：`apps/forge-objectstack/src/pages/bom-workspace.page.ts`、`src/actions/bom.action.ts` 和 `src/actions/shortage.action.ts`；字段及验收以仓库实际文件和脚本为准。

## 页面合同

| 区域 | 产品要求 | 已有能力及限制 |
| --- | --- | --- |
| 列表 | 搜索名称/编号，按类型、状态及适用项目筛选；点击指定记录进入详情 | 当前只是详情旁列出 BOM，需补真正列表及分页；不能只取前 100 条再假装全量 |
| 标题 | 展示名称、编号、类型、版本、状态及所属项目；刷新和返回路径稳定 | 已有字段可读取；项目上下文来自记录关联 |
| 基础资料 | 紧凑分组，区分只读和可编辑内容；相关对象显示名称 | 当前基本只读；任何新增编辑需先核对业务状态允许性，不用直接写对象绕过正式流转 |
| 结构 | 树形节点、类型、用量、位号、关键件；折叠可用且层级真实 | 目前将所有非根节点平铺，只实现真正存在的父子层级，不伪造树控件 |
| 缺料 | 生产数量输入、齐套指标、物料缺口明细、分析时间及历史结果 | 使用服务端计算；明确哪份快照对应当前输入，失败时保留已有结果并标识未更新 |
| 版本 | 当前族系版本列表，可打开具体版本 | 版本对比、替代及归档未完整实现，不显示为已可用操作 |
| 审批 | 中文状态和审批动作、时间、意见；对话框收集必需信息 | 使用已有日志和动作；不宣称已具备多角色审批权限 |
| 引用/图纸 | 只展示真实可读取的信息 | 当前占位；正式界面不保留带有工程实现说明的可点击空页签，缺口保留在验收清单 |

## 业务访问映射

读路径：`GET /api/v1/data/{object}` 及 `GET /api/v1/data/{object}/{id}`。对象包含 `forge_bom`、`forge_bom_node`、`forge_bom_approval_log`、`forge_bom_shortage_analysis`、`forge_bom_shortage_line` 及关联项目/客户/物料。筛选按真实关联 ID，兼容服务端分页。

写路径：`POST /api/v1/actions/forge_bom/{action}/{id}`，请求体保持现有 `{ params: ... }`。

| 用户操作 | 现有动作 | 参数及反馈 |
| --- | --- | --- |
| 提交评审 | `bom_submit_review` | 原动作决定可否提交，成功后回读状态及日志 |
| 处理评审 | `bom_review` | `decision`、`comment`；实际可用决定值以动作定义为准 |
| 复制新版本 | `bom_copy_new_version` | `change_note`；从动作返回与回读确定新记录，不能仍停留在旧记录却提示新版本已打开 |
| 失效 | `bom_invalidate` | `reason`；操作确认后由业务层校验并执行 |
| 分析缺料 | `bom_analyze_shortage` | `planned_quantity`；成功后回读新分析及明细 |

## 验收场景

1. 从列表找到指定项目 BOM；打开、刷新和返回后记录 ID 及上下文一致。无数据与加载错误分别展示。
2. 从草稿提交评审，通过业务对话框填写意见完成评审，回读原单状态及审批日志；不使用浏览器原生 prompt。
3. 依据既有缺料场景改变生产数量并分析，指标和明细与 API 一致；分析失败不把旧结果误标为新数量的结果。
4. 检查真实树层级及展开/折叠；长名称和宽表不挤坏标题、按钮和页面。
5. 必填缺失、接口拒绝时保留输入并定位错误；提交期间不能重复触发同一动作。
6. 使用独立数据库完整停服重启，重新打开上述记录及分析；保留前后截图与回读摘要。现有正式 BOM/缺料验收一同通过。

上述 Forge 侧场景已于 2026-09-10 运行。列表、详情、树形折叠、缺料快照、新版本复制、提交评审、必填错误和评审通过均已在页面核对；同库重启后由页面和 API 再次读取。精确记录见 `forge-productization-p0-verification.md`。RISEMAP 同材料成功办理仍待复核。
