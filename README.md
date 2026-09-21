# Weave Workbench

Weave Workbench 是桌面工作助手、智能体团队与 Forge 业务系统的统一产品仓库。

新会话从[项目状态](docs/project-status.md)开始，执行 `make status` 核对现场。主方案见[产品架构](docs/architecture/product-architecture.md)，协作方式见[工程管理](docs/engineering/README.md)。Weave 和 inoForge 保留独立源码主仓，本仓按确定版本组合交付，见[同步与发布](docs/architecture/delivery-model.md)。

第一版产品目标见[MVP1 验收方案](docs/plans/mvp1.md)，具体推进顺序见[MVP1 落地步骤](docs/plans/mvp1-delivery.md)。

用户在桌面端完成日常工作并提交材料，Weave 负责组织智能体、派发任务和保障执行，Forge 负责业务数据、流程、权限和最终业务结果。这个仓库负责把三者组合成一个可以发布、验证和持续演进的产品。

桌面端首次启动会提供“我的工作”，其中包含用户可直接看到的“材料”和“成果”文件夹。用户也可以选择任意本地文件夹作为工作空间，明确允许桌面助手读取和修改的范围。

## 目录

- `desktop/`：基于 GooeyPi 改造的 macOS 与 Windows 桌面产品。
- `platform/weave/`：智能体建队、协作、执行、恢复与额度治理。
- `platform/forge/`：ObjectStack 上的业务应用、业务动作和业务权限。
- `contracts/`：身份、材料、任务、动作、结果和审计契约。
- `scenarios/`：跨组件的真人业务验收场景。
- `docs/architecture/`：当前有效的产品和架构设计。
- `docs/environments/`：固定联调环境、部署边界和当前状态。
- `tools/`：本地联调、版本锁定、打包和发布工具。

## 当前第一条业务闭环

员工在桌面端提交销售合同材料，桌面助手将材料交给 Weave 的销售团队。团队从 Forge 读取可用业务能力，完成合同识别、校验、登记和提交，并向另一名员工创建待办。第二名员工在自己的桌面端处理待办，最终结果回写 Forge，并由发起人和审计者分别确认。

任何健康检查、模型自述、单个工具调用或阶段完成都不能单独算作业务验收通过。
