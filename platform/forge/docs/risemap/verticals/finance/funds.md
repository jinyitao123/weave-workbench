# 财务 / 资金管理

当前发现 8 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

## 纵向完成标准

1. 核对主数据和配置依赖，记录必填、默认值、编号及权限。
2. 保存新建表单的空态、校验、填写、提交和成功结果。
3. 跟踪详情页、状态转换、审批、撤回、驳回、作废和恢复。
4. 核对数量、金额、版本、库存或工时在上下游页面的变化。
5. 验证搜索、筛选、排序、分页、批量、导入导出、打印和附件。
6. 用重复提交、非法值、缺少权限、同时编辑和下游失败测试异常分支。
7. 用相关角色分别操作，形成菜单、记录、字段和动作权限矩阵。
8. Forge实现后用同一输入逐项对照外观、行为、数据和恢复结果。

## 页面与当前证据

| 编号 | 入口 | URL | 首屏标题 | 主要操作 | 证据 | 深度状态 |
| --- | --- | --- | --- | --- | --- | --- |
| RM-131 | 资金账户 | `https://risemap.cn/finance/bank-accounts` | 资金账户 | 新增账户、全部类型、全部状态、卡片视图、表格视图 | [截图](../../../references/risemap-capture/388-rm-131-loaded.png) | 首屏已采集，流程未验证 |
| RM-132 | 资金流水 | `https://risemap.cn/finance/bank-flow` | 资金流水 | 全部、待分配、部分分配、已分配、待审核、修改类型、批量审核、导出、刷新、资金账户、收支方向、流水类型、时间范围、上一页、1、下一页 | [截图](../../../references/risemap-capture/390-rm-132-loaded.png) | 首屏已采集，流程未验证 |
| RM-133 | 应收应付 | `https://risemap.cn/finance/accounts` | 应收应付 | 应收账款、应付账款、往来对冲、期初应收建账、期初应付建账、导出、刷新、账龄状态、来源、发票状态、业务员、到期提醒、上一页、1、下一页 | [截图](../../../references/risemap-capture/392-rm-133-loaded.png) | 首屏已采集，流程未验证 |
| RM-134 | 收款管理 | `https://risemap.cn/finance/payment-collections` | 收款管理 | 预收款管理 | [截图](../../../references/risemap-capture/394-rm-134-loaded.png) | 首屏已采集，流程未验证 |
| RM-135 | 付款管理 | `https://risemap.cn/finance/payment-writeoffs` | 付款管理 | 费用中心 · 付款申请、付款任务、预付款管理、批量登记付款、导出、刷新、状态、来源、上一页、1、下一页 | [截图](../../../references/risemap-capture/396-rm-135-loaded.png) | 首屏已采集，流程未验证 |
| RM-136 | 退款申请 | `https://risemap.cn/finance/refunds` | 退款申请 | 客户退款0、供应商退款0、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/398-rm-136-loaded.png) | 首屏已采集，流程未验证 |
| RM-137 | 授信额度管理 | `https://risemap.cn/finance/credit-management` | 授信额度管理 | 授信客户 0、待审批授信、导出、刷新、状态、冻结状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/400-rm-137-loaded.png) | 首屏已采集，流程未验证 |
| RM-138 | 借款贷款管理 | `https://risemap.cn/finance/loans` | 借款贷款管理 | 员工借款 0、银行贷款、申请借款、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/402-rm-138-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

尚无深度操作记录。没有实际操作证据的规则保持待验证。
