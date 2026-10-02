# OTC 演示账号与 ObjectStack 配置主册

2026-10-02 收尾核对：23个开发联调账号均通过本人当前凭据调用原生密码修改接口完成轮换，逐一确认新密码登录返回200、旧密码登录返回401、旧Forge会话已失效，并注销本轮验证会话。密码只保存在被Git忽略的本机 `scenarios/演示账号密码.local.md`（权限0600），不在对话或跟踪文档回显。该结果仅证明密码轮换与认证，不代表23个岗位的业务权限已经逐一验收，也不声称既有Weave会话或任务委托全部撤销；业务证据仍见对应场景与环境说明。

## 账号

| 人员 | Forge 登录账号 |
| --- | --- |
| 系统管理员 | admin@inoforge.local |
| 销售小王 | sales.wang@inoforge.local |
| 交付负责人小李 | delivery.li@inoforge.local |
| 商务财务小陈 | business.chen@inoforge.local |
| 团队开发者小周 | developer.zhou@inoforge.local |
| 解决方案小孙 | solution.sun@inoforge.local |
| PMO小刘 | pmo.liu@inoforge.local |
| 报价复核小赵 | pricing.zhao@inoforge.local |
| 法务小何 | legal.he@inoforge.local |
| 合同签署归档小胡 | signature.hu@inoforge.local |
| 订单复核小吴 | order.wu@inoforge.local |
| 物料资料小高 | material.gao@inoforge.local |
| 采购经办小张 | procurement.zhang@inoforge.local |
| 采购主管小宋 | procurement.review.song@inoforge.local |
| 生产经办小黄 | production.huang@inoforge.local |
| 生产主管小邵 | production.review.shao@inoforge.local |
| 仓库发货小马 | warehouse.ma@inoforge.local |
| 仓储主管小杜 | warehouse.review.du@inoforge.local |
| 质检小罗 | quality.luo@inoforge.local |
| 现场交付小徐 | field.xu@inoforge.local |
| 应收回款小林 | finance.lin@inoforge.local |
| 财务复核小唐 | finance.review.tang@inoforge.local |
| 售后小钱 | service.qian@inoforge.local |

## 岗位、角色、权限集与业务边界

| 人员 | ObjectStack 岗位 | 业务角色 | 权限集 | 业务边界 |
| --- | --- | --- | --- | --- |
| 系统管理员 | —（组织 owner） | 平台管理员 | 已授权：admin_full_access；organization_admin_no_bypass；forge_sales_settings_manager；forge_supply_chain_settings_manager | 仅维护联调环境、账号与业务设置；不代业务审批 |
| 销售小王 | sales_owner | 销售负责人 | 已绑定：sales_lead_owner；sales_lead_conversion_operator；sales_quotation_draft_operator；sales_quotation_adjustment_operator；sales_contract_operator；forge_project_operator；forge_project_reference_reader；forge_sales_reference_reader | 本人负责的线索、报价、合同与售前项目；不自批 |
| 交付负责人小李 | contract_delivery_reviewer；project_manager | 交付复核、项目经理 | 已绑定：sales_contract_reviewer；forge_project_operator；forge_project_manager | 分配的合同复核；本人负责的项目 |
| 商务财务小陈 | contract_commercial_reviewer；sales_order_operator | 商务复核、订单经办 | 已绑定：sales_contract_reviewer；sales_order_operator | 分配的合同及本人订单；不得审批本人创建的订单 |
| 团队开发者小周 | — | 智能体团队开发 | 个人授权：weave_team_developer | 团队配置与发布；无 Forge 销售资料权限 |
| 解决方案小孙 | solution_owner | 方案与 SOW | 已绑定：forge_solution_operator | 仅分配项目的需求、技术方案与 SOW |
| PMO小刘 | pmo_gate_reviewer | PMO 材料检查与评审组织 | 已绑定：forge_project_gate_reviewer | 仅分配项目的阶段材料；不代替正式批准人 |
| 报价复核小赵 | sales_quotation_reviewer | 报价复核 | 已绑定：sales_quotation_reviewer | 仅分配的冻结报价；不改明细，成本字段不默认开放 |
| 法务小何 | contract_legal_reviewer | 非标合同法务复核 | 已绑定：sales_contract_legal_reviewer | 仅分配非标合同的法律条款与意见 |
| 合同签署归档小胡 | contract_signature_registrar（显示名：合同管理员） | 签署材料登记与归档 | 已绑定：contract_signature_registrar | 仅已批准合同的签署版登记、回传与归档；无签字或审批权 |
| 订单复核小吴 | sales_order_reviewer | 订单独立复核 | 已绑定：sales_order_reviewer | 仅分配订单的来源、数量、金额和下单条件；不自审 |
| 物料资料小高 | material_master_operator | 物料主数据维护 | 已绑定：forge_material_master_operator | 物料、SKU、单位和客户物料映射；不批准订单 |
| 采购经办小张 | procurement_operator | 采购经办 | 已绑定：forge_procurement_operator | 获准缺料或计划范围内的采购与到货 |
| 采购主管小宋 | procurement_reviewer | 采购独立审批 | 已绑定：forge_procurement_reviewer | 仅审核采购申请、供应商和采购订单；不审核本人经办单据 |
| 生产经办小黄 | production_operator | 生产经办 | 已绑定：forge_production_operator | 有效订单和 BOM 范围内的生产计划、领料与完工 |
| 生产主管小邵 | production_reviewer | BOM与生产放行 | 已绑定：forge_production_reviewer | 仅复核BOM、下达和完工；不复核本人编制单据 |
| 仓库发货小马 | warehouse_fulfillment_operator | 仓储发货 | 已绑定：sales_order_fulfillment_operator；forge_warehouse_operator | 已审批订单的物料行发货；服务行不动库存，其他仓储能力未开通 |
| 仓储主管小杜 | warehouse_reviewer | 入库独立审批 | 已绑定：forge_warehouse_reviewer | 仅审核采购及期初入库；不审核本人经办单据 |
| 质检小罗 | quality_inspector | 质量检验 | 已绑定：forge_quality_inspector | 分配的到货、生产和交付质量记录 |
| 现场交付小徐 | delivery_executor | 现场交付 | 已绑定：forge_delivery_operator | 分配项目的施工、调试、交付包与整改 |
| 应收回款小林 | finance_receivables_operator | 应收与收款登记 | 已绑定：forge_finance_receivables_operator | 获准合同或订单的开票、应收和到账登记；不自批核销 |
| 财务复核小唐 | finance_reviewer | 财务独立复核 | 已绑定：forge_finance_reviewer | 分配的收款分配、核销和财务例外；不自审 |
| 售后小钱 | after_sales_operator | 售后服务 | 已绑定：forge_service_operator | 质保范围内的售后工单和服务结果 |
