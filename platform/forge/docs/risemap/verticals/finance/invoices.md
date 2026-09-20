# 财务 / 发票管理

当前发现 5 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-144 | 发票总览 | `https://risemap.cn/finance/invoices/overview` | 发票总览、全盘指标概览、月度发票趋势、税额构成分析、销项发票台账、进项发票与抵扣、未开票与开票任务 | 查看销项发票、管理进项发票、查看开票任务 | [截图](../../../references/risemap-capture/414-rm-144-loaded.png) | 首屏已采集，流程未验证 |
| RM-145 | 销项发票 | `https://risemap.cn/finance/invoices/sales` | 销项发票 | 导出、全部0、正常0、已作废0、已红冲0 | [截图](../../../references/risemap-capture/416-rm-145-loaded.png) | 首屏已采集，流程未验证 |
| RM-146 | 进项发票 | `https://risemap.cn/finance/invoices/purchase` | 进项发票 | 邮件收票、导出、全部0、正常0、已作废0、已红冲0、类型、抵扣状态 | [截图](../../../references/risemap-capture/418-rm-146-loaded.png) | 首屏已采集，流程未验证 |
| RM-147 | 开票任务 | `https://risemap.cn/finance/invoices/tasks` | 开票任务 | 刷新列表 | [截图](../../../references/risemap-capture/420-rm-147-loaded.png) | 首屏已采集，流程未验证 |
| RM-148 | 调整记录 | `https://risemap.cn/finance/invoices/adjustments` | 调整记录 | 无 | [截图](../../../references/risemap-capture/422-rm-148-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

尚无深度操作记录。没有实际操作证据的规则保持待验证。
