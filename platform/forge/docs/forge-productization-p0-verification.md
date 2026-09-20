# Forge 产品化 P0 验收记录

日期：2026-09-10。结论：Forge BOM 页面样板验收通过，RISEMAP 同材料对照待复核。

## 验收环境

- 分支：`codex/forge-productization`
- 消费基线：`4f8f59a`
- 服务：`http://localhost:4390`
- 数据库：`apps/forge-objectstack/.objectstack/productization-p0.sqlite`
- 数据库来源：已通过正式 BOM 与缺料分析验收的 `otc-shortage-analysis-final.sqlite` 副本；本次页面写入只发生在独立副本
- Node：`25.6.1`。项目声明范围为 `>=24.19.0 <25`，因此命令均产生 engine warning；实际门禁和验收结果如下

## 页面办理与结果

1. BOM 列表不重复渲染宿主页标题，项目筛选只列出实际存在 BOM 的项目；选择“800型柔性线控制柜交付项目”得到 2 条版本记录。从列表打开项目 BOM `QJiM2yQiwfQ1Nx21`，核对项目、客户、物料、V1.0 状态和 5 个真实层级节点。
2. 通过“复制新版本”对话框填写“产品化 P0 浏览器办理验证”，创建并自动打开 `pzRz5vyFgvG8e_dk`。新记录为 V1.1 草稿，复制了 5 个节点；从新版本打开版本历史仍能沿复制关系回读完整的 2 条版本族记录。
3. 提交评审后打开评审对话框。空意见显示中文就地错误，输入留在对话框内；填写“产品化 P0 页面、结构与用量核对通过”后通过评审。
4. 审批日志回读到 `submitted` 与 `approved` 两条记录；V1.1 状态为 `active`。
5. 在标准 BOM `HNNTfazuFQXcjF2l` 以计划数量 1 执行缺料分析，保存快照 `003AxIU9tW2xwdfa`。页面与 API 均显示齐套率 80%、采购件 4、缺口 1、最大可生产数 0、预计采购金额 ¥2,831.86，明细 4 行。将输入改为 2 后，页面明确提示当前结果仍基于数量 1。
6. 完整停止服务，再使用同一 SQLite 启动。内置浏览器重新打开 V1.1 并读取已生效状态和两条审批日志；API 回读再次得到相同记录、节点、日志、缺料摘要与明细。

## 视口证据

- [BOM 列表 1280×800](evidence/forge-productization-p0/bom-list-1280x800.png)
- [缺料分析 1440×900](evidence/forge-productization-p0/bom-shortage-1440x900.png)

两档视口均未出现页面级横向溢出。宽表在卡片内部保留滚动能力。内置浏览器还核对了列表、详情、树形折叠、版本创建、评审错误和重启后的审批日志。

## 自动检查

- `pnpm typecheck`：通过
- `pnpm validate`：通过
- `pnpm build`：通过
- `pnpm acceptance:formal-bom-restart`：通过
- `pnpm acceptance:bom-shortage-restart`：通过
- `tests/productized-bom-ui-readback.mjs`：通过

ObjectStack 对 22 个现有自定义 React 页面统一报告 `className` author-time warning。P0 样式通过页面内显式 `<style>` 注入，浏览器截图确认已经生效；该告警未掩盖 Tailwind 缺失。服务还报告已存在的 schema drift 与本地 OIDC 密钥解密告警，本次未修改对应存储结构或身份配置。

## 边界

本次没有修改 BOM 对象、动作和金额数量规则。结果证明 Forge 独立页面办理、持久化和重启回读成立。RISEMAP 已保存截图只用于页面合同和布局参考；没有在 RISEMAP 以同一材料完成复制、评审和缺料分析，因此 RISEMAP 对照状态保持待复核。P1 采购连续办理、P2 项目计划、P3 制造交付和 P4 财务经营页面仍在后续队列。
