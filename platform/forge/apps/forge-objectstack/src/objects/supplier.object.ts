import { Field } from '@objectstack/spec/data';
import { master, text, reference, choice, owner, remarks, status } from '../model.js';

const approval = Field.select([
  { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
  { value: 'approved', label: '已审批' }, { value: 'rejected', label: '已驳回' },
], { label: '审批状态', defaultValue: 'draft' });

// DP007: business status and approval status are independent.
export const Supplier = master('forge_supplier', '供应商管理', 'truck', {
  name: text('供应商名称', true), code: text('供应商编号'), credit_code: text('统一社会信用代码'), organization_code: text('组织机构代码'),
  registered_capital: Field.number({ label: '注册资本（万元）' }), established_on: Field.date({ label: '成立时间' }),
  legal_representative: text('法人名称'), province: text('省份'), city: text('市'), operating_status: text('经营状态'),
  category_id: reference('forge_supplier_category', '供应商分类', true), level_id: reference('forge_supplier_level', '供应商级别', true),
  responsible_id: owner(true), payment_term: text('付款条件'), contact_name: text('联系人', true), phone: text('联系电话', true),
  second_phone: text('第二电话'), email: Field.email({ label: '邮箱' }), contact_department: text('联系人部门'),
  contact_title: text('联系人职位'), contact_gender: text('联系人性别'), contact_employment_status: text('联系人任职状态'),
  payment_days: Field.number({ label: '账期（天）', defaultValue: 0 }), supplier_type: text('供应商类型'),
  address: text('地址'), remarks: remarks(), status: status(),
  approval_status: { ...approval, readonly: true }, approval_note: Field.textarea({ label: '审批意见', readonly: true }),
  approved_by: Field.user({ label: '审批人', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
}, ['name', 'code', 'level_id', 'category_id', 'contact_name', 'phone', 'email', 'approval_status', 'status']);

export const SupplierApprovalLog = master('forge_supplier_approval_log', '供应商审批记录', 'history', {
  name: text('记录名称', true), supplier_id: reference('forge_supplier', '供应商', true),
  action: Field.select([
    { value: 'submitted', label: '提交审批' }, { value: 'approved', label: '同意' }, { value: 'rejected', label: '驳回' },
  ], { label: '审批动作' }), from_status: text('原状态'), to_status: text('新状态'),
  comment: Field.textarea({ label: '审批意见' }), occurred_at: Field.datetime({ label: '操作时间', ...{ required: true, storage: { notNull: true } }, readonly: true }),
  operator_id: Field.user({ label: '操作人', ...{ required: true, storage: { notNull: true } }, readonly: true }),
}, ['supplier_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

export const SupplierBankAccount = master('forge_supplier_bank_account', '供应商银行账户', 'landmark', {
  name: text('户名', true), supplier_id: reference('forge_supplier', '供应商', true),
  bank: text('开户行'), branch: text('支行名称'), bank_number: text('行号'), account_number: text('银行账号'),
}, ['supplier_id', 'bank', 'branch', 'name', 'account_number']);
