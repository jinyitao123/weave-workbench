import { definePermissionSet } from '@objectstack/spec';
import type { PermissionSet as PermissionSetInput } from '@objectstack/spec/security';
import { withProjectPositionRowScopes } from './project-operator.permission.js';
const defineOtcPermissionSet = (definition: PermissionSetInput) => definePermissionSet(withProjectPositionRowScopes(definition));
import { salesQuotationCostFieldMask } from './sales-quotation.permission.js';

const ownRead = { allowRead: true, readScope: 'own' as const };
const ownReadExport = { ...ownRead, allowExport: true };
const ownEvidenceCreate = { allowCreate: true, allowRead: true, readScope: 'own' as const, writeScope: 'own' as const };
const orgRead = { allowRead: true, readScope: 'org' as const };
const orgMasterWork = {
  allowCreate: true, allowRead: true, allowEdit: true,
  readScope: 'org' as const, writeScope: 'org' as const,
};
const nonFinancialFieldMask = {
  ...salesQuotationCostFieldMask,
  'forge_project.total_cost': { readable: false },
  'forge_project.budget_amount': { readable: false },
  'forge_project.expected_revenue': { readable: false },
  'forge_project.contract_amount': { readable: false },
  'forge_project.invoice_amount': { readable: false },
  'forge_project.collected_amount': { readable: false },
  'forge_sales_order.total_amount': { readable: false },
  'forge_sales_order.company_account_id': { readable: false },
  'forge_sales_order.use_credit': { readable: false },
  'forge_sales_order.payment_term': { readable: false },
  'forge_sales_order.payment_method': { readable: false },
  'forge_sales_order.revenue_trigger': { readable: false },
  'forge_sales_order.recognized_amount': { readable: false },
  'forge_sales_order.planned_shipment_amount': { readable: false },
  'forge_sales_order.invoiced_amount': { readable: false },
  'forge_sales_order.shipped_amount': { readable: false },
  'forge_sales_order.collected_amount': { readable: false },
  'forge_sales_order_line.taxed_unit_price': { readable: false },
  'forge_sales_order_line.untaxed_unit_price': { readable: false },
  'forge_sales_order_line.taxed_subtotal': { readable: false },
  'forge_sales_contract.total_amount': { readable: false },
  'forge_sales_contract.company_account_id': { readable: false },
  'forge_sales_contract.order_amount_limit': { readable: false },
  'forge_sales_contract.revenue_trigger': { readable: false },
  'forge_sales_contract.ordered_amount': { readable: false },
  'forge_sales_contract.invoiced_amount': { readable: false },
  'forge_sales_contract.shipped_amount': { readable: false },
  'forge_sales_contract.collected_amount': { readable: false },
  'forge_sales_contract.payment_term': { readable: false },
  'forge_sales_contract.business_terms': { readable: false },
  'forge_sales_contract_line.taxed_unit_price': { readable: false },
  'forge_sales_contract_line.taxed_subtotal': { readable: false },
  'forge_customer.credit_limit': { readable: false },
  'forge_customer.bank_name': { readable: false },
  'forge_customer.bank_account': { readable: false },
  'forge_customer.tax_number': { readable: false },
  'forge_customer.invoice_type': { readable: false },
  'forge_customer.invoice_address': { readable: false },
  'forge_customer.invoice_phone': { readable: false },
  'forge_customer.payment_term': { readable: false },
  'forge_customer.payment_days': { readable: false },
  'forge_customer.revenue_recognition': { readable: false },
  'forge_inventory_balance.average_cost': { readable: false },
  'forge_inventory_balance.inventory_value': { readable: false },
  'forge_inventory_ledger.unit_cost': { readable: false },
  'forge_inventory_ledger.amount': { readable: false },
  'forge_purchase_order.total_amount': { readable: false },
  'forge_purchase_order_line.taxed_unit_price': { readable: false },
  'forge_purchase_order_line.taxed_subtotal': { readable: false },
} as const;

// A guarded Action form may edit these proposal fields while object-level CRUD stays read-only.
const serviceRequestInputFields = Object.fromEntries([
  ...['service_hours','treatment_record','service_result'].map(field => 'forge_service_order.' + field),
  ...['code','name','service_type','service_mode','urgency','expected_visit_on','customer_id','contact_id','contact_phone','sales_order_id','contract_id','service_object','service_address','region','fault_symptom','impact_scope','remarks','warranty_starts_on','warranty_ends_on','warranty_status','responsibility_type','quotation_handling'].map(field => 'forge_service_order.' + field),
  ...['name','source','impact','site','product_name','product_sn','customer_id','problem','contact_name','contact_phone','remarks'].map(field => 'forge_repair_request.' + field),
  ...['name','service_order_id','sku_id','warehouse_id','requested_quantity','request_on','remarks'].map(field => 'forge_service_part_request.' + field),
].map(field => [field, { readable: true, editable: true }]));

const serviceManagerInputFields = Object.fromEntries([
  ...['scheduled_at','dispatch_note'].map(field => 'forge_service_order.' + field),
  ...['name','code','category','description','remarks','status'].map(field => 'forge_service_config_item.' + field),
  ...['total_amount','valid_until','remarks'].map(field => 'forge_service_quotation.' + field),
  ...['total_amount','remarks'].map(field => 'forge_service_settlement.' + field),
].map(field => [field, { readable: true, editable: true }]));

// Preconfigure bounded reads and named capabilities. Transactional writes belong
// to domain Actions that enforce business state, record assignment and actor;
// only organization master-data maintenance uses generic create/edit grants.
export const solutionOperatorPermission = defineOtcPermissionSet({
  name: 'forge_solution_operator', label: '解决方案办理',
  description: '为有效任职项目上传技术材料、记录方案与SOW工作；不办理销售成交或项目审批。',
  systemPermissions: ['forge_solution_operator', 'forge_project_work_member'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_project: ownRead,
    forge_project_plan: orgRead,
    forge_project_member: orgRead,
    forge_project_work_item: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_daily_report: ownRead,
    forge_project_timesheet: ownReadExport,
    forge_project_expense: ownReadExport,
    forge_project_expense_line: ownReadExport,
    forge_project_attachment: ownRead,
    forge_project_log: ownEvidenceCreate,
    forge_customer: ownRead,
    forge_sales_contract: ownRead,
    forge_sales_contract_line: ownRead,
    forge_business_setting_option: orgRead,
    sys_file: ownRead,
  },
  rowLevelSecurity: [{
    name: 'solution_operator_task_type_read', object: 'forge_business_setting_option', operation: 'select',
    using: "scope == 'project' && setting_type == 'task_type'",
  }, {
    name: 'work_member_own_daily_report_read', object: 'forge_project_daily_report', operation: 'select',
    using: 'owner_id == current_user.id',
  }],
});

export const projectGateReviewerPermission = defineOtcPermissionSet({
  name: 'forge_project_gate_reviewer', label: '项目阶段材料复核',
  description: '为有效任职项目检查阶段材料并登记评审组织记录；正式阶段批准另由审批流程决定。',
  systemPermissions: ['forge_project_gate_reviewer'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_project: ownRead,
    forge_project_plan: ownRead,
    forge_project_work_item: ownRead,
    forge_project_attachment: ownRead,
    forge_project_log: ownEvidenceCreate,
    forge_project_type: orgRead,
  },
});

export const contractLegalReviewerPermission = defineOtcPermissionSet({
  name: 'sales_contract_legal_reviewer', label: '非标合同法务复核',
  description: '按原生审批分配读取非标合同及条款；不修改合同或代替商务审批。',
  systemPermissions: ['sales_contract_legal_reviewer'],
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_sales_contract: ownRead,
    forge_sales_contract_line: ownRead,
    forge_customer: ownRead,
    forge_contact: ownRead,
    forge_contract_type: orgRead,
    sys_file: ownRead,
  },
});

export const contractSignatureRegistrarPermission = defineOtcPermissionSet({
  name: 'contract_signature_registrar', label: '合同签署材料登记',
  description: '仅持有签署材料登记能力；正式登记动作再次核对合同状态、员工授权和材料归属。',
  systemPermissions: ['contract_signature_registrar'],
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_sales_contract: orgRead,
    sys_file: ownRead,
  },
  rowLevelSecurity: [{
    name: 'approved_unsigned_contract_for_registrar',
    object: 'forge_sales_contract', operation: 'select',
    using: "status == 'active' && (signed_on == null || signed_recorded_by == current_user.id)",
  }],
});

export const materialMasterOperatorPermission = defineOtcPermissionSet({
  name: 'forge_material_master_operator', label: '物料主数据维护',
  description: '维护组织内物料、SKU 和计量单位；无报价审批、订单审批或库存过账权。',
  systemPermissions: ['forge_material_master_operator'],
  fields: { 'forge_material_sku.cost_price': { readable: false } },
  objects: {
    forge_material: orgMasterWork,
    forge_material_sku: orgMasterWork,
    forge_unit: orgMasterWork,
    forge_material_category: orgRead,
    forge_warehouse: orgRead,
    forge_supplier: orgRead,
    forge_customer_material_map: ownRead,
  },
});

export const procurementOperatorPermission = defineOtcPermissionSet({
  name: 'forge_procurement_operator', label: '采购经办',
  description: '办理本人负责的采购申请、询价、订单与到货跟进；不独立批准采购或入库。',
  systemPermissions: ['forge_procurement_operator'],
  objects: {
    forge_purchase_request: ownRead,
    forge_purchase_request_line: ownRead,
    forge_purchase_inquiry: ownRead,
    forge_purchase_inquiry_line: ownRead,
    forge_purchase_order: ownRead,
    forge_purchase_order_line: ownRead,
    forge_purchase_arrival_notice: ownRead,
    forge_purchase_arrival_notice_line: ownRead,
    forge_purchase_receipt: ownRead,
    forge_purchase_receipt_line: ownRead,
    forge_purchase_order_approval_log: orgRead,
    forge_bom: orgRead,
    forge_bom_shortage_analysis: orgRead,
    forge_bom_shortage_line: orgRead,
    forge_supplier: orgRead,
    forge_supplier_category: orgRead,
    forge_supplier_level: orgRead,
    forge_customer: orgRead,
    sys_user: orgRead,
    forge_purchase_request_approval_log: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
    forge_unit: orgRead,
    forge_warehouse: orgRead,
    forge_project: ownRead,
  },
});

export const procurementReviewerPermission = defineOtcPermissionSet({
  name: 'forge_procurement_reviewer', label: '采购独立审批',
  description: '独立审核采购申请、供应商及采购订单；不经办本人提交的单据。',
  systemPermissions: ['forge_procurement_reviewer'],
  objects: {
    forge_purchase_request: orgRead,
    forge_purchase_request_line: orgRead,
    forge_purchase_order: orgRead,
    forge_purchase_order_line: orgRead,
    forge_purchase_arrival_notice: orgRead,
    forge_purchase_order_approval_log: orgRead,
    forge_warehouse: orgRead,
    forge_bom: orgRead,
    forge_supplier: orgRead,
    forge_supplier_category: orgRead,
    forge_supplier_level: orgRead,
    forge_supplier_price_book: orgRead,
    forge_supplier_price_book_line: orgRead,
    forge_customer: orgRead,
    forge_project: orgRead,
    forge_unit: orgRead,
    sys_user: orgRead,
    forge_purchase_request_approval_log: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
  },
});

export const productionOperatorPermission = defineOtcPermissionSet({
  name: 'forge_production_operator', label: '生产经办',
  description: '办理本人负责的组装、领退补料和完工记录；不维护物料主数据或财务成本。',
  systemPermissions: ['forge_production_operator'],
  objects: {
    forge_assembly_order: ownRead,
    forge_assembly_material_line: ownRead,
    forge_production_material_document: ownRead,
    forge_production_material_document_line: ownRead,
    forge_production_inbound: ownRead,
    forge_bom: orgRead,
    forge_bom_node: orgRead,
    forge_bom_approval_log: orgRead,
    forge_bom_shortage_analysis: orgRead,
    forge_bom_shortage_line: orgRead,
    forge_project: ownRead,
    forge_customer: ownRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
    forge_inventory_balance: orgRead,
    forge_warehouse: orgRead,
    forge_sales_order: ownRead,
  },
});

export const productionReviewerPermission = defineOtcPermissionSet({
  name: 'forge_production_reviewer', label: '生产独立复核',
  description: '独立复核 BOM、生产下达与完工依据；不代经办人填写领退补料。',
  systemPermissions: ['forge_production_reviewer'],
  objects: {
    forge_bom: orgRead,
    forge_bom_node: orgRead,
    forge_bom_approval_log: orgRead,
    forge_bom_shortage_analysis: orgRead,
    forge_bom_shortage_line: orgRead,
    forge_project: ownRead,
    forge_customer: ownRead,
    forge_assembly_order: orgRead,
    forge_assembly_material_line: orgRead,
    forge_production_material_document: orgRead,
    forge_production_inbound: orgRead,
    forge_warehouse: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
  },
});

export const warehouseOperatorPermission = defineOtcPermissionSet({
  name: 'forge_warehouse_operator', label: '仓储办理',
  description: '办理本人负责的入库、出库和库存操作；销售发货仍由独立订单发货权限控制。',
  systemPermissions: ['forge_warehouse_operator'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_purchase_inbound: ownRead,
    forge_purchase_inbound_line: ownRead,
    forge_inventory_operation: ownRead,
    forge_other_inbound: ownRead,
    forge_other_inbound_line: ownRead,
    forge_other_outbound: ownRead,
    forge_other_outbound_line: ownRead,
    forge_inventory_balance: orgRead,
    forge_inventory_ledger: orgRead,
    forge_inventory_serial_number: orgRead,
    forge_purchase_order: orgRead,
    forge_purchase_order_line: orgRead,
    forge_purchase_inspection: orgRead,
    forge_purchase_inbound_approval_log: orgRead,
    forge_supplier: orgRead,
    sys_user: orgRead,
    forge_warehouse: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
  },
});

export const warehouseReviewerPermission = defineOtcPermissionSet({
  name: 'forge_warehouse_reviewer', label: '仓储独立放行',
  description: '独立审核采购入库与期初入库；不代仓库经办人办理实物过账。',
  systemPermissions: ['forge_warehouse_reviewer'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_purchase_inbound: orgRead,
    forge_purchase_inbound_line: orgRead,
    forge_purchase_inspection: orgRead,
    forge_purchase_inbound_approval_log: orgRead,
    forge_purchase_order: orgRead,
    forge_purchase_order_line: orgRead,
    forge_supplier: orgRead,
    sys_user: orgRead,
    forge_opening_inbound: orgRead,
    forge_opening_inbound_line: orgRead,
    forge_other_inbound: orgRead,
    forge_other_outbound: orgRead,
    forge_inventory_balance: orgRead,
    forge_warehouse: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
  },
});

export const qualityInspectorPermission = defineOtcPermissionSet({
  name: 'forge_quality_inspector', label: '质量检验',
  description: '记录本人负责的到货和生产检验结论；不采购、付款或修改物料主数据。',
  systemPermissions: ['forge_quality_inspector'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_purchase_inspection: ownRead,
    forge_purchase_inspection_item: ownRead,
    forge_pending_inspection: orgRead,
    forge_purchase_receipt: orgRead,
    forge_purchase_order: orgRead,
    forge_supplier: orgRead,
    forge_purchase_arrival_notice: orgRead,
    forge_purchase_arrival_notice_line: orgRead,
    forge_production_inbound: ownRead,
    forge_inspection_plan: orgRead,
    forge_inspection_plan_item: orgRead,
    sys_user: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
  },
});

export const deliveryOperatorPermission = defineOtcPermissionSet({
  name: 'forge_delivery_operator', label: '项目现场交付',
  description: '办理本人负责项目的调试、交付资料、验收与整改；不办理项目财务结算。',
  systemPermissions: ['forge_delivery_operator', 'forge_project_work_member'],
  fields: nonFinancialFieldMask,
  objects: {
    forge_project: ownRead,
    forge_commissioning_record: ownRead,
    forge_commissioning_check: ownRead,
    forge_delivery_package: ownRead,
    forge_delivery_package_item: ownRead,
    forge_customer_acceptance: ownRead,
    forge_customer_acceptance_item: ownRead,
    forge_acceptance_rectification: ownRead,
    forge_project_attachment: ownRead,
    sys_file: ownRead,
  },
});

export const financeReceivablesOperatorPermission = defineOtcPermissionSet({
  name: 'forge_finance_receivables_operator', label: '应收与收款登记',
  description: '登记本人负责的发票、应收和实际到账；不审核本人核销。',
  systemPermissions: ['forge_finance_receivables_operator', 'forge_sales_gross_profit_read'],
  objects: {
    forge_sales_invoice: orgRead,
    forge_sales_invoice_line: orgRead,
    forge_accounts_receivable: orgRead,
    forge_cash_receipt: ownRead,
    forge_customer_prepayment: ownRead,
    sys_file: ownRead,
    forge_collection_allocation: ownRead,
    forge_fund_account: orgRead,
    forge_customer: orgRead,
    forge_sales_contract: orgRead,
    forge_sales_order: orgRead,
    forge_sales_order_line: orgRead,
    forge_project: orgRead,
    forge_project_sales_link: orgRead,
    forge_project_settlement: orgRead,
    sys_user: orgRead,
  },
});

export const financeReviewerPermission = defineOtcPermissionSet({
  name: 'forge_finance_reviewer', label: '财务独立复核',
  description: '读取待复核的收款分配与应收记录；核销决定须由受控业务动作校验且不得自审。',
  systemPermissions: ['forge_finance_reviewer', 'forge_sales_gross_profit_read'],
  objects: {
    forge_sales_invoice: orgRead,
    forge_accounts_receivable: orgRead,
    forge_cash_receipt: orgRead,
    forge_customer_prepayment: orgRead,
    forge_collection_allocation: orgRead,
    forge_purchase_inbound: orgRead,
    forge_fund_account: orgRead,
    forge_customer: orgRead,
    forge_sales_order: orgRead,
    forge_sales_contract: orgRead,
    forge_project: orgRead,
    forge_project_sales_link: orgRead,
    forge_supplier: orgRead,
    sys_user: orgRead,
  },
  rowLevelSecurity: [
    { name: 'review_reversible_receipts', object: 'forge_cash_receipt', operation: 'select', using: "status == 'pending_review' || status == 'unallocated' || status == 'partially_allocated' || status == 'allocated'" },
    { name: 'review_reversible_allocations', object: 'forge_collection_allocation', operation: 'select', using: "status == 'pending_review' || status == 'approved'" },
  ],
});

export const serviceOperatorPermission = defineOtcPermissionSet({
  name: 'forge_service_operator', label: '售后服务办理',
  description: '办理指派给本人的服务工单与服务结果；客户、联系人、订单和合同按本人记录或工单关联分享读取，不办理报价、结算与应收。',
  systemPermissions: ['forge_service_operator'],
  fields: { ...nonFinancialFieldMask, ...serviceRequestInputFields },
  objects: {
    forge_service_order: ownRead,
    forge_repair_request: ownRead,
    forge_service_part_request: ownRead,
    forge_service_part_request_event: ownRead,
    forge_warranty_card: ownRead,
    forge_warranty_card_event: ownRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
    forge_warehouse: orgRead,
    forge_customer: ownRead,
    forge_contact: ownRead,
    forge_sales_order: ownRead,
    forge_sales_contract: ownRead,
    sys_file: ownRead,
  },
});

export const serviceManagerPermission = defineOtcPermissionSet({
  name: 'forge_service_manager', label: '售后服务主管',
  description: '受理、派工并跟踪本组织售后工单，维护服务报价、结算和应收衔接。',
  systemPermissions: ['forge_service_manager'],
  fields: { ...nonFinancialFieldMask, ...serviceRequestInputFields, ...serviceManagerInputFields },
  objects: {
    forge_service_order: orgRead,
    forge_repair_request: orgRead,
    forge_service_part_request: orgRead,
    forge_service_part_request_event: orgRead,
    forge_service_quotation: orgRead,
    forge_service_settlement: orgRead,
    forge_warranty_card: orgRead,
    forge_warranty_card_event: orgRead,
    forge_material: orgRead,
    forge_material_sku: orgRead,
    forge_warehouse: orgRead,
    forge_customer: orgRead,
    forge_contact: orgRead,
    forge_sales_order: orgRead,
    forge_sales_contract: orgRead,
    forge_service_config_item: orgRead,
    sys_user: orgRead,
    sys_file: ownRead,
  },
});
