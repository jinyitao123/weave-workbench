# Forge 产品化 P2 验收记录

日期：2026-09-10。结论：项目计划与执行工作台通过 Forge 页面、API 和持久化重启验收；RISEMAP 同材料页面对照保持待复核。

## 验收环境

- 分支：`codex/forge-productization-p2`
- 起点：`0bfeb36`
- 页面服务：`http://localhost:4392`
- 页面验收数据库：`apps/forge-objectstack/.objectstack/productization-p2.sqlite`
- 业务门禁服务：`http://localhost:4393`
- 业务门禁数据库：`apps/forge-objectstack/.objectstack/productization-p2-business-gate.sqlite`
- 两个数据库均为已通过项目计划执行验收库的独立 SQLite 副本；本次页面写入和门禁重放互不影响

## 页面办理与结果

1. 从项目计划列表打开“800型柔性线控制柜交付项目计划 V1”，计划表回读到一个阶段、一个里程碑和两个任务，已有计划进度为 83%。
2. 通过“新增工作项”对话框创建任务“确认电气接口与现场边界”，所属阶段、2026-09-10 至 2026-09-12、关键路径标记和产出物均保存成功。计划工作项数从 4 增为 5。
3. 将新任务更新为 25%，页面与 API 回读状态为进行中、实际开始日期为 2026-09-10；阶段和计划按四个下级工作项的简单平均回算为 69%。
4. 为新任务提交日报，回读完成内容、25% 完成度、阻塞“客户尚未确认现场网络接口”和协助“请项目经理协调客户技术负责人确认”。日报总数从 2 增为 3。
5. 甘特图按已保存计划日期显示阶段、任务和里程碑；时间轴为只读，没有提供未经验证的拖动排程、基线或自动关键路径入口。
6. 完整停止 4392 服务并使用同一 SQLite 重启后，API 再次回读到 5 个工作项、69% 计划与阶段进度、新任务实际日期和日报。重新打开同一页面后，计划表保持相同结果。

## 视口证据

- [计划树表 1280×800](evidence/forge-productization-p2/project-plan-table-1280x800.png)
- [只读甘特图 1440×900](evidence/forge-productization-p2/project-plan-gantt-1440x900.png)

两个视口的页面根宽度均等于视口宽度，没有页面级横向溢出。计划宽表和甘特时间轴保留在卡片内滚动。

## 自动检查

- `pnpm typecheck`：通过
- `pnpm validate`：通过
- `pnpm build`：通过
- `FORGE_URL=http://localhost:4393 pnpm acceptance:project-plan-execution`：7 组通过
- 完整停服重启后 `FORGE_URL=http://localhost:4393 pnpm acceptance:project-plan-execution-restart`：通过
- 页面数据库完整停服重启前后 `tests/productized-project-plan-ui-readback.mjs`：均通过

ObjectStack 对 25 个现有自定义 React 页面统一报告 `className` author-time warning；工作台样式通过页面内显式 CSS 注入，两档浏览器截图确认已经生效。重启时仍报告已有采购表 storage metadata drift，本次没有修改对应对象或列。

## 边界

本批次没有修改项目计划对象、业务动作或进度回算规则。当前完成的是 Forge 项目计划页面产品化和对应独立验收；后续已补充计划模板保存、读取、空计划套用及已有工作项阻断。计划修订流转、拖动排程、基线、自动关键路径计算、附件上传控件和岗位权限仍未实现；多个前置关系以及 RISEMAP 模板同材料仍待复核。
