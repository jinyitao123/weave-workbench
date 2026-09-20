import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, remarks, required } from '../model.js';

const enabled = () => Field.boolean({ label: '启用', defaultValue: true });
const sortOrder = () => Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 });

export const InventoryBusinessSetting = master('forge_inventory_business_setting', '库存业务配置', 'sliders-horizontal', {
  name: text('名称', true), code: code('编码'), category: Field.select([
    { value: 'damage_type', label: '报损类型' }, { value: 'other_outbound_type', label: '其他出库类型' },
    { value: 'lock_reason', label: '锁库原因' }, { value: 'release_reason', label: '释放原因' },
    { value: 'inspection_category', label: '检验项目分类' }, { value: 'express_company', label: '快递公司' },
    { value: 'logistics_company', label: '物流公司' },
  ], { label: '配置分类', required: true, storage: { notNull: true } }),
  description: Field.textarea({ label: '用途说明' }), color: text('标识颜色'), enabled: enabled(), sort_order: sortOrder(), remarks: remarks(),
}, ['category', 'name', 'code', 'enabled', 'sort_order', 'description']);

export const DrawingBusinessSetting = master('forge_drawing_business_setting', '图纸业务配置', 'ruler', {
  name: text('名称', true), code: code('编码'), category: Field.select([
    { value: 'drawing_type', label: '图纸类型' }, { value: 'drawing_category', label: '图纸分类' },
    { value: 'change_type', label: '变更类型' }, { value: 'change_level', label: '变更等级' },
    { value: 'version_type', label: '版本类型' }, { value: 'review_category', label: '评审分类' },
    { value: 'participant_role', label: '参与人角色' }, { value: 'issue_category', label: '问题分类' },
    { value: 'issue_severity', label: '问题严重度' },
  ], { label: '配置分类', required: true, storage: { notNull: true } }),
  description: Field.textarea({ label: '用途说明' }), color: text('标识颜色'), enabled: enabled(), sort_order: sortOrder(), remarks: remarks(),
}, ['category', 'name', 'code', 'enabled', 'sort_order', 'description']);

export const SubcontractBusinessSetting = master('forge_subcontract_business_setting', '委外业务配置', 'factory', {
  name: text('名称', true), code: code('编码'), category: Field.select([
    { value: 'dictionary', label: '委外字典' }, { value: 'process_type', label: '加工类型' },
    { value: 'return_reason', label: '退料原因' }, { value: 'rule', label: '委外规则' },
    { value: 'alert_threshold', label: '预警阈值' }, { value: 'strategy', label: '业务策略' },
  ], { label: '配置分类', required: true, storage: { notNull: true } }),
  parent_id: reference('forge_subcontract_business_setting', '上级加工类型'), value: text('配置值'), description: Field.textarea({ label: '用途说明' }), color: text('标识颜色'),
  enabled: enabled(), sort_order: sortOrder(), remarks: remarks(),
}, ['category', 'parent_id', 'name', 'code', 'value', 'enabled', 'sort_order', 'description']);

// RISEMAP links supplier capabilities, processing prices and order lines through
// the processing type. Forge keeps the price as an effective-dated business
// record so new orders can carry the current price while historical lines keep
// their saved snapshot.
export const SubcontractProcessingPrice = master('forge_subcontract_processing_price', '委外加工价目', 'badge-chinese-yuan', {
  name: text('价目名称', true), code: code('价目编号'),
  supplier_profile_id: reference('forge_subcontract_supplier_profile', '委外供应商', true),
  process_type_id: reference('forge_subcontract_business_setting', '加工类型', true),
  sku_id: reference('forge_material_sku', '指定加工件'),
  unit_name: text('计价单位', true),
  unit_price: Field.currency({ label: '加工单价', precision: 18, scale: 4, min: 0, ...required }),
  effective_from: Field.date({ label: '生效日期', ...required }),
  effective_to: Field.date({ label: '失效日期' }),
  status: Field.select([
    { value: 'active', label: '生效中' }, { value: 'inactive', label: '已停用' },
  ], { label: '价目状态', defaultValue: 'active', required: true, storage: { notNull: true } }),
  responsible_id: Field.user({ label: '负责人' }), description: Field.textarea({ label: '适用说明' }), remarks: remarks(),
}, ['code', 'supplier_profile_id', 'process_type_id', 'sku_id', 'unit_name', 'unit_price', 'effective_from', 'effective_to', 'status']);

export const SubcontractPolicy = master('forge_subcontract_policy', '委外控制规则', 'shield-check', {
  name: text('规则名称', true), code: code('规则编号'),
  stock_age_warning_days: Field.number({ label: '在外物料账龄预警（天）', min: 1, scale: 0, defaultValue: 30 }),
  overdue_order_warning_days: Field.number({ label: '订单超期未交预警（天）', min: 0, scale: 0, defaultValue: 1 }),
  pending_reconciliation_count: Field.number({ label: '待对账数量阈值（张）', min: 1, scale: 0, defaultValue: 5 }),
  pending_reconciliation_age_days: Field.number({ label: '待对账账龄阈值（天）', min: 1, scale: 0, defaultValue: 15 }),
  reminder_interval_days: Field.number({ label: '重复提醒间隔（天）', min: 1, scale: 0, defaultValue: 7 }),
  issue_lock_days: Field.number({ label: '发料锁库天数', min: 1, scale: 0, defaultValue: 7 }),
  over_issue_control: Field.select([{ value: 'block', label: '禁止' }, { value: 'warn', label: '警告放行' }], { label: '超发控制', defaultValue: 'block' }),
  over_issue_tolerance: Field.number({ label: '超发容差倍数', min: 1, scale: 4, defaultValue: 1.5 }),
  over_receive_control: Field.select([{ value: 'block', label: '禁止' }, { value: 'warn', label: '警告放行' }], { label: '超收控制', defaultValue: 'block' }),
  over_receive_tolerance: Field.number({ label: '超收容差倍数', min: 1, scale: 4, defaultValue: 1 }),
  supplier_admission_control: Field.select([{ value: 'block', label: '禁止' }, { value: 'warn', label: '警告放行' }], { label: '供应商准入校验', defaultValue: 'block' }),
  reconciliation_dimension: Field.select([{ value: 'supplier', label: '按供应商' }, { value: 'order', label: '按委外订单' }], { label: '默认对账生成维度', defaultValue: 'supplier' }),
  apply_loss_rate_limit: Field.boolean({ label: '按损耗率上限计算超耗', defaultValue: false }),
  supplier_category_code: text('委外供应商分类编码'),
  status: Field.select([{ value: 'active', label: '生效中' }, { value: 'inactive', label: '已停用' }], { label: '状态', defaultValue: 'active' }),
  responsible_id: Field.user({ label: '负责人' }), remarks: remarks(),
}, ['code', 'stock_age_warning_days', 'overdue_order_warning_days', 'pending_reconciliation_count', 'pending_reconciliation_age_days', 'reminder_interval_days', 'issue_lock_days', 'over_issue_control', 'over_issue_tolerance', 'over_receive_control', 'over_receive_tolerance', 'supplier_admission_control', 'reconciliation_dimension', 'apply_loss_rate_limit', 'supplier_category_code', 'status']);
