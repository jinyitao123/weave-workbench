# 人事配置页面合同

- RISEMAP 入口：`https://risemap.cn/settings/business/hr`
- Forge 入口：`/_console/apps/forge/page/page_hr_business_config`
- 岗位：人事管理员、行政管理员
- 主数据：人事配置项、请假全局规则、工资项
- 主原型：配置型；左侧分类导航，右侧当前配置面板
- RISEMAP 当前事实：2026-09-21 在已登录内置浏览器实时核对 12 个分类；岗位、职级、假期类型、交通方式为空；补签、班次、假日、招聘渠道、手册分类、制度分类存在当前选项；请假配置提供 15/30/60 分钟、跨午休开关及“按起始日班次”；工资项按收入与扣款分栏。
- Forge 实现：十二分类可切换；通用配置、带类型值配置、分类颜色与图标、工资项均可增改、启停和二次确认删除；请假规则可保存。列表型、分类型、请假规则和工资项分别按 RISEMAP 当前结构呈现，不再共用同一种卡片布局。
- Forge 产品决策：破坏性删除增加标准二次确认；分类图标和主题色保存在共享业务设置项中。
- 2026-09-21 本轮实时对照：在内置浏览器同时打开 RISEMAP 与 Forge，逐项核对岗位管理空态、请假配置、补签类型、工资项配置和手册分类。修正请假配置的三张规则卡、彩色图标、选项按钮、开关和策略标签；修正补签类型的蓝色序号与开关；修正工资项的上下分区；修正手册分类的拖拽把手、灰色图标和文字状态。Forge 在 1280、760、520 三档检查均无页面级横向溢出或控件重叠。
- 持久化回读：页面将跨午休自动扣减从关闭改为开启并保存；首次停服重启发现 `upsert` 种子覆盖配置，已将可编辑业务配置种子改为 `ignore`；重新保存并第二次完整停服重启后，开关保持开启。
- 同材料交互：使用 `审计走查-交通方式-0921` 在两侧完成新增，编辑为 `审计走查-交通方式-0921-已编辑`，再停用。Forge 完整停服重启后记录名称和停用状态均保持。Forge 空名称提交出现“请填写名称”；RISEMAP 空名称保存未显示明确字段错误，属于当前线上交互事实。
- 删除阶段：RISEMAP 的垃圾桶图标没有二次确认，点击后立即删除测试记录并显示“已删除”；Forge 按产品安全决策展示包含对象名称、不可恢复影响和“确认删除”的标准二次确认弹窗。获得用户确认后执行删除，页面显示“配置已删除”；完整停服重启后记录仍不存在且交通方式恢复空态。
- 同视口证据：`hr-business-config/risemap-transport-disabled-906x776.jpg`、`hr-business-config/forge-transport-disabled-906x776.jpg`、`hr-business-config/full-viewport-overlay-906x776.png`、`hr-business-config/full-viewport-diff-906x776.png`、`hr-business-config/risemap-after-delete-906x776.jpg`、`hr-business-config/forge-delete-confirmation-906x776.jpg`、`hr-business-config/forge-after-delete-restart-906x776.jpg`。全视口 SSIM 为 `0.731285`，PSNR 为 `17.743206 dB`；数值包含 RISEMAP 展开侧栏、顶栏、页签栏与 Forge Console 外壳差异，不能作为业务内容区通过值。
- 收口结论：2026-09-21 用户确认当前页面可视为业务完成并继续后续页面；已保存双侧页面、同材料交互、删除确认和停服重启回读证据。清单仍保留 `review_required` 仅表示仓库级 `accepted` 门禁要求的结构化像素文件尚不齐全，不再作为继续后续页面的阻断项。
