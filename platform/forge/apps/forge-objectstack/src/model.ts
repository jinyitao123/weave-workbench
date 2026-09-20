import { Field, ObjectSchema } from '@objectstack/spec/data';

export const required = { required: true, storage: { notNull: true } } as const;
export const text = (label: string, mandatory = false) => Field.text({ label, ...(mandatory ? required : {}), maxLength: 255 });
export const code = (label: string) => Field.text({ label, ...required, unique: true, maxLength: 100 });
export const reference = (object: string, label: string, mandatory = false) => Field.lookup(object, { label, ...(mandatory ? required : {}) });
const optionCodes = {
  启用: 'active', 停用: 'inactive', 企业: 'company', 个人: 'person',
  手机: 'mobile', 座机: 'telephone', 邮箱: 'email', 草稿: 'draft', 待确认: 'pending', 待审批: 'pending_approval',
  已审批: 'approved', 已驳回: 'rejected', 已发送: 'sent', 已接受: 'accepted',
  已签订: 'signed', 履行中: 'active', 执行中: 'active', 已暂停: 'suspended', 已终止: 'terminated', 已到期: 'expired', 已完成: 'completed',
  直接新建: 'direct', 关联合同: 'contract', 已确认: 'confirmed', 部分发货: 'partially_shipped', 已发货: 'shipped', 已取消: 'cancelled',
  待发货: 'pending_shipment', 部分出库: 'partially_outbounded', 已出库: 'outbounded',
  银行转账: 'bank_transfer', 支付宝: 'alipay', 微信支付: 'wechat_pay', 现金: 'cash', 支票: 'cheque',
  其他: 'other', 电汇: 'wire_transfer', 承兑汇票: 'bank_acceptance', 在线支付: 'online_payment', 信用证: 'letter_of_credit',
  按发货出库: 'shipment', 按开票: 'invoice', 按里程碑: 'milestone', 按验收: 'acceptance', 按周期: 'period', 手动确认: 'manual',
  物料: 'material', 服务项目: 'service',
  原材料: 'raw_material', 半成品: 'semi_finished', 成品: 'finished', 贸易商品: 'traded',
  消耗品: 'consumable', 服务: 'service', 备件: 'spare', 包装材料: 'packaging',
  采购: 'purchased', 自制: 'manufactured', 外协: 'subcontracted', 虚拟: 'virtual',
  标准: 'standard', 项目: 'project', 试制: 'trial', 根节点: 'root', 分组: 'group', 子BOM: 'sub_bom',
} as const;
type OptionLabel = keyof typeof optionCodes;
export const choice = (label: string, values: OptionLabel[], defaultValue?: OptionLabel) => Field.select(
  values.map(value => ({ value: optionCodes[value], label: value })),
  { label, ...(defaultValue ? { defaultValue: optionCodes[defaultValue] } : {}) },
);
export const money = (label: string, scale = 2) => Field.currency({ label, precision: 18, scale });
export const owner = (mandatory = false) => Field.user({ label: '负责人', ...(mandatory ? required : {}) });
export const remarks = () => Field.textarea({ label: '备注' });
export const status = () => choice('业务状态', ['启用', '停用'], '启用');

export function dictionary(name: string, label: string) {
  return ObjectSchema.create({
    name, label, pluralLabel: label, icon: 'list', sharingModel: 'private',
    fields: { name: text('名称', true), code: text('编码'), sort_order: Field.number({ label: '排序', defaultValue: 0 }), status: status(), remarks: remarks() },
    nameField: 'name', listViews: { all: { label: '全部', type: 'grid', columns: ['name', 'code', 'status', 'sort_order'] } },
    enable: { apiEnabled: true, searchable: true, trackHistory: true },
  });
}

export function master(name: string, label: string, icon: string, fields: Record<string, Field>, columns: string[]) {
  return ObjectSchema.create({
    name, label, pluralLabel: label, icon, sharingModel: 'private', fields,
    nameField: 'name', listViews: { all: { label: '全部', type: 'grid', columns } },
    enable: { apiEnabled: true, searchable: true, trackHistory: true },
  });
}
