# 行政 / 行政管理

当前发现 12 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。

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
| RM-103 | 公司通知 | `https://risemap.cn/ops/notices` | 公司通知 | 发布通知、导出、刷新、类别、范围、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/332-rm-103-loaded.png) | 首屏已采集，流程未验证 |
| RM-104 | 用章管理 | `https://risemap.cn/ops/seals` | 用章管理 | 用章申请 (0)、待盖章任务、印章台账 (0)、用章统计、新建用章申请、导出、刷新、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/334-rm-104-loaded.png) | 首屏已采集，流程未验证 |
| RM-105 | 会议纪要 | `https://risemap.cn/ops/meetings` | 会议纪要 | 新建会议纪要、导出、刷新、类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/336-rm-105-loaded.png) | 首屏已采集，流程未验证 |
| RM-106 | 工作汇报 | `https://risemap.cn/ops/reports` | 工作汇报 | 工作汇报、汇报规则、新建汇报、导出、刷新、类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/338-rm-106-loaded.png) | 首屏已采集，流程未验证 |
| RM-107 | 文档中心 | `https://risemap.cn/ops/docs` | 文档中心 | 新建文件夹、上传文件夹、上传文件、收藏、按日期 | [截图](../../../references/risemap-capture/340-rm-107-loaded.png) | 首屏已采集，流程未验证 |
| RM-108 | 固定资产 | `https://risemap.cn/ops/assets` | 固定资产 | 新增资产、批量导入、导出、执行月度折旧、刷新、状态、全部分类、全部部门、上一页、1、下一页 | [截图](../../../references/risemap-capture/342-rm-108-loaded.png) | 首屏已采集，流程未验证 |
| RM-109 | 资质与申报 | `https://risemap.cn/ops/certificates` | 资质与申报 | 资质台账、到期提醒、政策申报、材料库、新增资质、导出、刷新、类别、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/344-rm-109-loaded.png) | 首屏已采集，流程未验证 |
| RM-110 | 物料领取 | `https://risemap.cn/ops/materials` | 物料领取 | 提交申请、领取申请、物品库、领取记录、全部状态 | [截图](../../../references/risemap-capture/346-rm-110-loaded.png) | 首屏已采集，流程未验证 |
| RM-111 | 设备维护 | `https://risemap.cn/ops/equipment-maintenance` | 设备维护保养 | 设备台账、工单管理、维保规则、提醒中心 0、费用统计、新增设备、导入、模板、导出、刷新、状态、分类、上一页、1、下一页 | [截图](../../../references/risemap-capture/348-rm-111-loaded.png) | 首屏已采集，流程未验证 |
| RM-112 | 礼品管理 | `https://risemap.cn/ops/gift/apply` | 礼品管理 | 礼品申请 0、礼品清单 0、礼品库管理 0、礼品库流水 0、新建申请、导出、刷新、类型、状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/350-rm-112-loaded.png) | 首屏已采集，流程未验证 |
| RM-113 | 借出管理 | `https://risemap.cn/ops/lending` | 借出管理 | 全部0、草稿0、待审批0、借用中0、逾期未还0、已归还0、已驳回0、导出、新建借用单、刷新、方向、对象、上一页、1、下一页 | [截图](../../../references/risemap-capture/352-rm-113-loaded.png) | 首屏已采集，流程未验证 |
| RM-114 | 车辆管理 | `https://risemap.cn/ops/vehicles` | 车辆管理 | 公司用车(0)、私车公用(0)、用车日历、车辆台账(0)、用车统计、公司用车申请、刷新、全部公司、全部状态、上一页、1、下一页 | [截图](../../../references/risemap-capture/354-rm-114-loaded.png) | 首屏已采集，流程未验证 |

## 深度走查记录

尚无深度操作记录。没有实际操作证据的规则保持待验证。
