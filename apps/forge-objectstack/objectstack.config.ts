import { defineStack, type NavigationItemInput } from '@objectstack/spec';
import * as objects from './src/objects/index.js';
import * as actions from './src/actions/index.js';
import * as pages from './src/pages/index.js';
import * as hooks from './src/hooks/index.js';
import * as seedData from './src/data/index.js';

const object = (id: string, label: string, objectName: string, icon?: string) => ({
  id, type: 'object' as const, label, objectName, ...(icon ? { icon } : {}),
});

const group = (id: string, label: string, children: NavigationItemInput[], icon?: string) => ({
  id, type: 'group' as const, label, children, expanded: true, ...(icon ? { icon } : {}),
});

// Placeholder pages that temporarily back several not-yet-built menu entries.
// Only these keep a `nav` identity in the URL so the Console can restore the
// exact entry after refresh. Every other page maps 1:1 from its pageName and
// must stay standard — a custom param on every entry is exactly what the stock
// Console does not understand, which broke Forge's menu/path mapping while the
// platform's own apps (setup/account) kept working.
const MULTI_ENTRY_PAGES = new Set(['page_reports_gap', 'page_system_gap']);

const page = (id: string, label: string, pageName: string, icon?: string) => ({
  id,
  type: 'page' as const,
  label,
  pageName,
  ...(MULTI_ENTRY_PAGES.has(pageName) ? { params: { nav: id } } : {}),
  ...(icon ? { icon } : {}),
});

export default defineStack({
  manifest: {
    id: 'forge', namespace: 'forge', version: '0.1.0', type: 'app', name: 'Forge',
    engines: { protocol: '>=17.3.0 <18' },
  },
  objects: Object.values(objects),
  data: Object.values(seedData),
  actions: Object.values(actions),
  hooks: Object.values(hooks),
  pages: Object.values(pages),
  apps: [{
    name: 'forge', label: 'Forge', icon: 'factory', active: true, isDefault: true,
    // Keep RISEMAP's observed top-level information architecture. Empty areas
    // remain visible structure gaps and do not imply implemented capability.
    areas: [
      {
        id: 'workspace', label: '工作台', icon: 'layout-dashboard', navigation: [
          group('workspace_overview', '工作台', [
            page('workspace_home', '工作台', 'page_workbench', 'layout-dashboard'),
            page('workspace_ai', 'AI 广场', 'page_workspace_ai', 'sparkles'),
            page('workspace_guidance', '引导中心', 'page_onboarding_center', 'book-open'),
            page('workspace_todo', '待办管理', 'page_todo_management', 'list-todo'),
          ]),
        ],
      },
      {
        id: 'supply_chain', label: '供应链', icon: 'boxes', navigation: [
          group('arrival_inspection', '到货检验', [
            page('purchase_arrival_notices', '到货通知', 'page_purchase_arrival_notice', 'package-search'),
            page('purchase_receipts', '到货登记', 'page_purchase_arrival_workspace', 'package-check'),
            page('pending_inspections', '待检验库存', 'page_pending_inspection_workspace', 'clipboard-clock'),
            page('purchase_inspections', '检验单', 'page_purchase_inspection_workspace', 'clipboard-check'),
            page('inspection_rules', '检验规则', 'page_inspection_rules', 'list-check'),
          ]),
          group('supply_master_data', '基础资料', [
            page('materials', '物料管理', 'page_material_workspace', 'package'),
            page('material_combinations', '物料组合', 'page_material_combinations', 'boxes'),
            page('bom_workspace', 'BOM管理', 'page_bom_workspace', 'git-branch'),
            page('material_search', '综合物料搜索', 'page_material_search', 'search'),
            page('suppliers', '供应商管理', 'page_supplier_workspace', 'truck'),
            page('product_trace', '产品实例追溯', 'page_product_trace', 'search-check'),
            page('warehouses', '仓库管理', 'page_warehouse_workspace', 'warehouse'),
          ]),
          group('purchase_management', '采购管理', [
            page('purchase_invoices', '采购发票', 'page_purchase_invoice_entry', 'receipt-text'),
            page('purchase_requests', '采购申请', 'page_purchase_request_pool', 'file-plus-2'),
            page('purchase_todo', '采购待办池', 'page_purchase_todo_pool', 'list-todo'),
            page('purchase_inquiry', '询价管理', 'page_purchase_inquiry', 'messages-square'),
            page('purchase_orders', '采购订单', 'page_purchase_order_workspace', 'shopping-cart'),
            page('purchase_returns', '采购退换货', 'page_purchase_return', 'rotate-ccw'),
            page('supplier_prices', '供应商价格本', 'page_supplier_price_book', 'badge-dollar-sign'),
          ]),
          group('inbound_management', '入库管理', [
            page('all_inbounds', '全部入库单', 'page_all_inbounds', 'package-plus'),
            page('purchase_inbounds', '采购入库', 'page_purchase_inbound_workspace', 'package-plus'),
            page('production_inbounds', '生产入库', 'page_production_inbound_entry', 'package-plus'),
            page('other_inbounds', '其他入库', 'page_other_inbounds', 'package-plus'),
            page('opening_inbounds', '期初入库', 'page_opening_inbounds', 'package-plus'),
            page('inbound_lines', '入库明细', 'page_inbound_lines', 'list'),
          ]),
          group('inventory_management', '库存管理', [
            page('inventory_balances', '库存总览', 'page_inventory_overview', 'boxes'),
            page('inventory_ncr', '不合格处理', 'page_inventory_ncr', 'triangle-alert'),
            page('inventory_disposal_center', '处置执行中心', 'page_inventory_disposal_center', 'clipboard-check'),
            page('inventory_ledgers', '库存流水', 'page_inventory_ledger', 'book-open'),
            page('inventory_locks', '库存锁定', 'page_inventory_locks', 'lock'),
            page('inventory_count', '库存盘点', 'page_inventory_count', 'clipboard-check'),
            page('inventory_transfer', '调拨与借出', 'page_inventory_transfer', 'arrow-left-right'),
            page('inventory_alerts', '库存预警', 'page_inventory_alerts', 'bell-ring'),
            page('inventory_loss', '报损单', 'page_inventory_loss', 'file-warning'),
            page('inventory_sn', 'SN码管理', 'page_inventory_sn', 'scan-line'),
          ]),
          group('outbound_management', '出库管理', [
            page('sales_outbounds', '出库单列表', 'page_sales_outbound_list', 'truck'),
            page('production_outbounds', '生产出库', 'page_production_outbounds', 'package-minus'),
            page('other_outbounds', '其他出库', 'page_other_outbounds', 'package-minus'),
            page('sales_direct_outbounds', '销售直接出库', 'page_sales_direct_outbounds', 'package-minus'),
            page('pending_shipments', '待出库发货单', 'page_pending_outbound_shipments', 'list-todo'),
            page('purchase_return_outbounds', '采购退换货出库', 'page_purchase_return_outbounds', 'undo-2'),
            page('outbound_lines', '出库明细', 'page_outbound_lines', 'list'),
          ]),
        ],
      },
      {
        id: 'sales', label: '销售', icon: 'badge-dollar-sign', navigation: [
          group('sales_business', '销售业务', [
            page('sales_contracts', '框架销售合同', 'page_sales_contract_workspace', 'scroll-text'),
            page('sales_orders', '销售订单', 'page_sales_order_workspace', 'clipboard-list'),
            page('sales_additional_fees', '附加费用', 'page_sales_additional_fee', 'receipt'),
            page('sales_collections', '收款流水', 'page_sales_collection_flow', 'badge-dollar-sign'),
            page('sales_shipments', '销售发货单', 'page_sales_shipment_workspace', 'package-check'),
            page('sales_returns', '销售退货', 'page_sales_return_workspace', 'undo-2'),
            page('sales_performance_bank', '业绩银行', 'page_sales_performance_bank', 'landmark'),
            page('sales_pricing', '价格策略', 'page_sales_pricing', 'tag'),
            page('goodwill_orders', 'Goodwill订单', 'page_goodwill_orders', 'gift'),
            page('sales_teams', '销售团队', 'page_sales_teams', 'users'),
            page('sales_targets', '销售目标', 'page_sales_targets', 'target'),
            page('sales_invoices', '销售发票', 'page_sales_invoice_request', 'receipt-text'),
          ]),
          group('crm_customer_management', 'CRM客户管理', [
            page('customers', '客户管理', 'page_sales_customers', 'building-2'),
            page('contacts', '联系人管理', 'page_sales_contacts', 'contact'),
            page('quotations', '销售报价', 'page_sales_quotations', 'file-text'),
            page('customer_material_map', '客户物料对照', 'page_customer_material_map', 'tags'),
            page('opportunities', '商机管理', 'page_sales_opportunities', 'sparkles'),
            page('leads', '线索管理', 'page_sales_leads', 'funnel'),
            page('follow_ups', '跟进记录', 'page_sales_follow_ups', 'messages-square'),
            page('customer_pool', '公海客户', 'page_customer_pool', 'users-round'),
          ]),
          group('service_management', '服务管理', [
            page('service_orders', '服务工单', 'page_service_orders', 'wrench'),
            page('service_quotations', '服务报价单', 'page_service_quotations', 'file-text'),
            page('service_settlements', '服务结算单', 'page_service_settlements', 'receipt-text'),
            page('service_workspace', '接单中心', 'page_service_workspace', 'calendar-check'),
            page('service_dispatch', '派工中心', 'page_service_dispatch', 'route'),
            page('service_analysis', '服务分析', 'page_service_analysis', 'chart-no-axes-combined'),
            page('warranty_management', '质保管理', 'page_warranty_management', 'shield-check'),
            page('service_config', '服务配置', 'page_service_config', 'settings'),
          ]),
        ],
      },
      {
        id: 'production', label: '生产', icon: 'factory', navigation: [
          group('assembly_management', '组装业务管理', [
            page('production_prerequisites', '生产准备检查', 'page_production_prerequisites', 'list-checks'),
            page('assembly_orders', '组装单', 'page_production_assembly_workspace', 'factory'),
            page('assembly_shortages', '缺料待办', 'page_production_shortage_workspace', 'triangle-alert'),
            page('production_issues', '领料单', 'page_production_material_workspace', 'package-minus'),
            page('production_supplies', '补料单', 'page_production_supply_workspace', 'package-plus'),
            page('production_returns', '退料单', 'page_production_return_workspace', 'undo-2'),
            page('disassembly_orders', '拆解单', 'page_production_disassembly_workspace', 'unplug'),
            page('replacement_orders', '换件单', 'page_production_replacement_workspace', 'replace'),
          ]),
          group('drawing_management', '图纸管理', [
            page('drawing_guide', '进入图纸管理上手指南', 'page_drawing_guide', 'book-open'),
            page('drawing_workspace', '图纸总览', 'page_drawing_workspace', 'ruler'),
            page('drawing_archive', '图号档案', 'page_drawing_archive', 'archive'),
            page('drawing_review', '图纸评审', 'page_drawing_review', 'clipboard-check'),
            page('drawing_release', '图纸发布', 'page_drawing_release', 'send'),
            page('drawing_change', '图纸变更', 'page_drawing_change', 'git-compare'),
            page('drawing_distribution', '图纸发放记录', 'page_drawing_distribution', 'history'),
            page('drawing_query', '图纸关联查询', 'page_drawing_query', 'search'),
            page('customer_drawings', '客户图纸', 'page_customer_drawings', 'file-image'),
          ]),
          group('subcontract_management', '委外管理', [
            page('subcontract_guide', '进入委外管理上手指南', 'page_subcontract_guide', 'book-open'),
            page('subcontract_dashboard', '委外看板', 'page_subcontract_dashboard', 'layout-dashboard'),
            page('subcontract_workspace', '委外订单', 'page_subcontract_workspace', 'clipboard-list'),
            page('subcontract_issues', '委外发料', 'page_subcontract_issue_workspace', 'package-minus'),
            page('subcontract_receipts', '委外回厂', 'page_subcontract_receipt_workspace', 'package-check'),
            page('subcontract_returns', '委外退料', 'page_subcontract_return_workspace', 'undo-2'),
            page('subcontract_reconciliation', '委外对账', 'page_subcontract_reconciliation', 'file-check-2'),
            page('subcontract_suppliers', '委外供应商', 'page_subcontract_suppliers', 'factory'),
            page('subcontract_pricing', '加工价目', 'page_subcontract_pricing', 'badge-chinese-yuan'),
            page('subcontract_stock', '委外库存', 'page_subcontract_stock', 'warehouse'),
            page('subcontract_trace', '批次追溯', 'page_subcontract_trace', 'search-check'),
            page('subcontract_undelivered', '委外未交', 'page_subcontract_undelivered', 'list-todo'),
            page('subcontract_inbound_report', '委外进货', 'page_subcontract_inbound_report', 'package-search'),
            page('subcontract_reconciliation_report', '委外对账单', 'page_subcontract_reconciliation_report', 'file-chart-column'),
          ]),
        ],
      },
      {
        id: 'project', label: '项目', icon: 'briefcase-business', navigation: [
          group('project_management', '项目管理', [
            page('projects', '项目中心', 'page_project_center', 'briefcase-business'),
            page('project_operating_analysis', '项目分析中心', 'page_project_operating_analysis', 'chart-no-axes-combined'),
            page('project_plan_workspace', '任务管理', 'page_project_task_workspace', 'list-checks'),
            page('project_timesheet_cost', '工时管理', 'page_project_timesheet_cost', 'clock-3'),
            page('project_settings', '项目配置中心', 'page_project_settings', 'sliders-horizontal'),
          ]),
          group('project_execution_and_cost', '项目执行与成本', [
            page('delivery_acceptance_workspace', '交付验收', 'page_delivery_acceptance_workspace', 'badge-check'),
            page('project_expense_cost', '项目费用与成本', 'page_project_expense_cost', 'hand-coins'),
          ]),
        ],
      },
      {
        id: 'administration', label: '行政', icon: 'building', navigation: [
          group('approval_center', '审批中心', [
            page('my_approvals', '我的审批', 'page_my_approvals', 'check-check'),
            page('cc_to_me', '抄送我的', 'page_cc_to_me', 'send'),
            page('initiated_by_me', '我发起的', 'page_initiated_by_me', 'file-up'),
            page('administration_requests', '行政申请', 'page_administration_requests', 'file-plus-2'),
          ]),
          group('administration_management', '行政管理', [
            page('administration_notice', '公司通知', 'page_administration_notice', 'megaphone'),
            page('seal_management', '用章管理', 'page_seal_management', 'stamp'),
            page('meeting_minutes', '会议纪要', 'page_meeting_minutes', 'notebook-pen'),
            page('work_reports', '工作汇报', 'page_work_reports', 'clipboard-list'),
            page('document_center', '文档中心', 'page_document_center', 'folder-open'),
            page('fixed_assets', '固定资产', 'page_fixed_assets', 'building-2'),
            page('qualification_declaration', '资质与申报', 'page_qualification_declaration', 'file-check-2'),
            page('material_pickup', '物料领取', 'page_material_pickup', 'package'),
            page('equipment_maintenance', '设备维护', 'page_equipment_maintenance', 'wrench'),
            page('gift_management', '礼品管理', 'page_gift_management', 'gift'),
            page('loan_management', '借出管理', 'page_loan_management', 'handshake'),
            page('vehicle_management', '车辆管理', 'page_vehicle_management', 'car'),
          ]),
          group('human_resources', '人力资源', [
            page('hr_workspace', '人事工作台', 'page_hr_workspace', 'layout-dashboard'),
            page('employee_records', '员工档案', 'page_employee_records', 'contact'),
            page('recruitment', '招聘管理', 'page_recruitment', 'user-plus'),
            page('onboarding_offboarding', '入职离职', 'page_onboarding_offboarding', 'log-out'),
            page('salary_benefits', '薪酬福利', 'page_salary_benefits', 'wallet-cards'),
            page('rules_policies', '规章制度', 'page_rules_policies', 'book-open'),
            page('directory', '通讯录', 'page_directory', 'contact-round'),
          ]),
          group('attendance_leave', '考勤假期', [
            page('overtime_requests', '加班申请', 'page_overtime_requests', 'clock-3'),
            page('leave_management', '请假管理', 'page_leave_management', 'calendar-off'),
            page('business_trip', '出差申请', 'page_business_trip', 'plane'),
            page('attendance_management', '考勤管理', 'page_attendance_management', 'calendar-check'),
            page('attendance_statistics', '考勤统计', 'page_attendance_statistics', 'chart-column'),
          ]),
          group('process_center', '流程中心', [
            page('approval_records', '审批记录', 'page_approval_records', 'history'),
            page('start_process', '发起流程', 'page_start_process', 'play'),
            page('process_definitions', '流程定义', 'page_process_definitions', 'git-branch'),
            page('process_categories', '流程分类', 'page_process_categories', 'tags'),
          ]),
        ],
      },
      {
        id: 'finance', label: '财务', icon: 'landmark', navigation: [
          group('fund_management', '资金管理', [
            page('fund_accounts', '资金账户', 'page_fund_accounts', 'wallet'),
            page('bank_flow', '资金流水', 'page_bank_flow', 'landmark'),
            page('bank_statement', '银行余额对账', 'page_bank_statement', 'file-check-2'),
            page('opening_balance', '期初往来账与对冲', 'page_opening_balance', 'book-open-check'),
            page('receivables_payables', '应收应付', 'page_receivables_payables', 'scale'),
            page('customer_prepayment', '收款管理', 'page_customer_prepayment', 'badge-dollar-sign'),
            page('purchase_payment', '付款管理', 'page_purchase_payment', 'send-horizontal'),
            page('refunds', '退款申请', 'page_supplier_refund', 'undo-2'),
            page('credit_limits', '授信额度管理', 'page_credit_management', 'gauge'),
            page('loans', '借款贷款管理', 'page_finance_loans', 'hand-coins'),
          ]),
          group('business_confirmation', '业务确认', [
            page('revenue_recognition', '销售收入确认', 'page_revenue_recognition', 'badge-dollar-sign'),
            page('cost_center', '成本中心', 'page_finance_cost_center', 'chart-pie'),
            page('expense_center', '费用中心', 'page_finance_expense_center', 'receipt'),
            page('reimbursement', '报销管理', 'page_finance_reimbursement', 'file-spreadsheet'),
            page('reconciliation_pool', '待对账池', 'page_reconciliation_pool', 'list-filter'),
            page('customer_reconciliation', '客户对账', 'page_customer_reconciliation', 'file-check-2'),
            page('supplier_reconciliation', '供应商对账', 'page_supplier_reconciliation', 'file-check-2'),
          ]),
          group('invoice_management', '发票管理', [
            page('invoice_overview', '发票总览', 'page_invoice_overview', 'files'),
            page('output_invoices', '销项发票', 'page_output_invoices', 'receipt-text'),
            page('input_invoices', '进项发票', 'page_input_invoices', 'receipt-text'),
            page('invoice_tasks', '开票任务', 'page_invoice_tasks', 'list-todo'),
            page('invoice_adjustments', '调整记录', 'page_invoice_adjustments', 'history'),
            page('invoice_tax_variances', '税率差异留痕', 'page_invoice_tax_variances', 'badge-percent'),
            page('invoice_reversal', '发票冲销（Forge）', 'page_invoice_reversal', 'receipt-text'),
            page('collection_settlement', '开票与结算（Forge）', 'page_collection_settlement_workspace', 'wallet-cards'),
          ]),
        ],
      },
      {
        id: 'reports', label: '报表', icon: 'chart-no-axes-combined', navigation: [
          group('business_reports', '报表', [
            page('sales_statistics', '销售统计', 'page_sales_statistics', 'chart-column'),
            page('purchase_statistics', '采购统计', 'page_purchase_statistics', 'chart-column'),
            page('inventory_statistics', '库存统计', 'page_inventory_statistics', 'chart-column'),
            page('assembly_statistics', '组装统计', 'page_assembly_statistics', 'chart-column'),
          ]),
          group('finance_reports', '财务统计', [
            page('finance_overview', '财务总览', 'page_finance_overview', 'layout-dashboard'),
            page('profit_loss', '损益分析', 'page_profit_loss', 'chart-pie'),
            page('management_profit_report', '管理利润表', 'page_management_profit_report', 'file-chart-column'),
            page('fund_analysis', '资金分析', 'page_fund_analysis', 'chart-line'),
            page('receivable_report', '往来账款', 'page_current_account_analysis', 'scale'),
            page('tax_inventory', '税务库存', 'page_tax_inventory_analysis', 'file-chart-column'),
            page('risk_monitoring', '风险监控', 'page_risk_monitoring', 'shield-alert'),
          ]),
        ],
      },
      {
        id: 'business_settings', label: '业务设置', icon: 'settings', navigation: [
          group('material_settings', '商品管理', [
            object('material_skus', '规格与价格', 'forge_material_sku', 'boxes'),
            object('material_categories', '物料分类', 'forge_material_category', 'tags'),
            object('units', '计量单位', 'forge_unit', 'ruler'),
            object('supplier_categories', '供应商分类', 'forge_supplier_category', 'tags'),
            object('supplier_levels', '供应商级别', 'forge_supplier_level', 'star'),
          ]),
          group('customer_settings', '客户管理', [
            object('customer_categories', '客户分类', 'forge_customer_category', 'tags'),
            object('customer_levels', '客户级别', 'forge_customer_level', 'star'),
          ]),
          group('purchase_sales_settings', '采购销售', [
            object('payment_conditions', '付款条件', 'forge_payment_condition', 'calendar-clock'),
            object('quotation_types', '报价类型', 'forge_quotation_type', 'tags'),
            object('quotation_issuers', '报价主体', 'forge_quotation_issuer', 'landmark'),
            object('contract_types', '合同类型', 'forge_contract_type', 'tags'),
          ]),
          group('inventory_settings', '库存管理', [
            object('warehouse_types', '仓库类型', 'forge_warehouse_type', 'warehouse'),
            page('inventory_business_config', '库存管理配置', 'page_inventory_business_config', 'sliders-horizontal'),
          ]),
          group('project_business_settings', '项目管理', [
            page('project_business_config', '项目管理配置', 'page_project_business_config', 'briefcase-business'),
          ]),
          group('finance_settings', '财务配置', [page('finance_business_config', '付款方式与费用类别', 'page_finance_business_config', 'landmark')]),
          group('administration_settings', '行政管理', [page('administration_business_config', '行政管理配置', 'page_administration_business_config', 'building')]),
          group('other_settings', '其他配置', [page('other_business_config', '其他配置', 'page_other_business_config', 'sliders-horizontal')]),
          group('hr_settings', '人事配置', [page('hr_business_config', '人事配置', 'page_hr_business_config', 'users')]),
          group('drawing_settings', '图纸配置', [page('drawing_business_config', '图纸配置', 'page_drawing_business_config', 'ruler')]),
          group('production_settings', '生产配置', [page('production_config', '生产配置', 'page_production_config', 'factory')]),
          group('subcontract_settings', '委外配置', [
            page('subcontract_business_config', '委外字典', 'page_subcontract_business_config', 'truck'),
            page('subcontract_policy', '委外控制规则', 'page_subcontract_policy', 'shield-check'),
          ]),
          group('document_printing', '单据打印', [page('document_printing', '单据打印', 'page_print_business_config', 'printer')]),
          group('plugin_center', '插件中心', [page('plugin_center_gap', '插件中心', 'page_system_gap', 'blocks')]),
          group('service_subscription', '服务订阅', [page('service_subscription_gap', '服务订阅', 'page_system_gap', 'rss')]),
          group('promotion_rewards', '推广奖励', [page('promotion_rewards_gap', '推广奖励', 'page_system_gap', 'award')]),
          group('field_management', '字段管理', [page('field_management_gap', '字段管理', 'page_system_gap', 'list')]),
        ],
      },
    ],
  }],
});
