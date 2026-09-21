# 行政管理业务设置页面合同

- RISEMAP 入口：`https://risemap.cn/settings/business/office`
- Forge 入口：`/_console/apps/forge/page/page_administration_business_config`
- 页面职责：维护行政业务使用的分类、类型、渠道、阶段和借用原因。
- 岗位：行政管理员。
- 主数据：`forge_business_setting_option`，范围固定为 `administration`。
- 当前事实：RISEMAP 展示资产分类、物料类别、购买渠道、福利分类、会议类型、资质类别、申报类别、申报阶段、借用原因九类入口；资质类别与借用原因当前为空，其余可见值按实时页面保存为种子。
- 动作：切换分类、新增、编辑、启停、删除；资产分类支持上级分类，借用原因按借出与借入方向维护。
- 阻断：名称和编码必填，编码不可重复，有子级的资产分类不可删除；删除使用二次确认。
- 下一步：行政业务页面读取已启用选项；停用不改写历史记录。
- 视觉基线：同视口对齐 RISEMAP 的标题、模块标签、左侧九类导航、列表卡片、开关、编辑与删除动作及说明区。
- 状态：已实现，待独立复核后方可从 `review_required` 提升为 `accepted`。
