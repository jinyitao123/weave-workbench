# Forge ObjectStack 局部说明

先读取并遵守仓库根的 [AGENTS.md](../../AGENTS.md)。本文件仅补充应用目录信息，不替代主仓的取证、页面精修、持续执行、工程门禁或业务验收要求。

- 当前 `objectstack.config.ts` 中的 `defineStack()` 仍是既有单应用注册入口；七应用拆分尚待实施，每个应用包遵循最多一个 App 的约束；依赖和脚本以 [package.json](package.json) 为准，使用 pnpm。
- 对象、动作、hooks、页面分别由 `src/objects/index.ts`、`src/actions/index.ts`、`src/hooks/index.ts`、`src/pages/index.ts` 汇总，以 `Object.values()` 注册；共享导航和 barrel 的并行修改按主仓集成规则处理。
- 配置属性使用 camelCase，机器名称使用 snake_case，元数据类型名使用单数，文件使用 `{name}.{type}.ts`。通过 `@objectstack/spec` 的公开入口使用协议定义，不从包内部相对路径导入；新增 schema 遵循 Zod-first 并用 `z.infer<>` 派生类型。
- CEL 条件按对应 Skill 使用 `record.<field>`，不要用未绑定的裸字段名。具体约束通过主仓规定的 typecheck、validate、build 与相称业务检查验证。
- 项目 Skill 位于仓库根的 `.agents/skills/`；按主仓的 Skill 路由读取，不在本目录复制技能目录、安装步骤或维护另一套技能清单。
- 页面开发从[交付标准](../../docs/forge-page-delivery-standard.md)、[精修基线](../../docs/forge-page-polish-baseline.md)和当前页面合同开始；应用说明见 [README.md](README.md)。
