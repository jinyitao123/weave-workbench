# 其他配置页面合同

- RISEMAP：`https://risemap.cn/settings/business/other`
- Forge：`/_console/apps/forge/page/page_other_business_config`
- 职责：维护会议室、印章类型、文件类型、设备分类、维护与维修类型、工单费用分类、维护项目配件和单据命名规则。
- 当前事实：RISEMAP 当前会议室首屏包含搜索、状态筛选、刷新、总数/启用/停用/总容量指标和新增会议室；当前会议室数量为 0。其余八类入口已实时观察，登录态过期前未取得其字典值，因此 Forge 不预置推断值。
- 动作：分类切换、新增、编辑、启停、删除确认；会议室另含位置和容量。
- 状态：已实现，保持 `review_required`，待恢复 RISEMAP 登录后补齐其余八类同材料对照。
