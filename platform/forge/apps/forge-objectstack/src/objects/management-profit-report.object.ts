import { Field, ObjectSchema } from '@objectstack/spec/data';

const amount = (label: string) => Field.currency({ label, precision: 18, scale: 2, min: 0, defaultValue: 0 });

export const ManagementProfitReportVersion = ObjectSchema.create({
  name: 'forge_management_profit_report_version',
  label: '管理利润表版本',
  pluralLabel: '管理利润表版本',
  icon: 'file-chart-column',
  sharingModel: 'public_read_write',
  nameField: 'name',
  fields: {
    name: Field.text({ label: '版本名称', required: true }),
    code: Field.text({ label: '版本号', required: true }),
    accounting_period: Field.text({ label: '会计期间', required: true }),
    organization_name: Field.text({ label: '核算组织', required: true }),
    dimension: Field.select([
      { value: 'company', label: '公司' }, { value: 'project', label: '项目' }, { value: 'department', label: '部门' },
    ], { label: '统计维度', defaultValue: 'company', required: true }),
    compare_basis: Field.select([
      { value: 'year_on_year', label: '同期对比' }, { value: 'none', label: '不对比' },
    ], { label: '对比口径', defaultValue: 'year_on_year', required: true }),
    currency: Field.text({ label: '展示币种', defaultValue: 'CNY', required: true }),
    amount_unit: Field.select([
      { value: 'yuan', label: '元' }, { value: 'ten_thousand', label: '万元' },
    ], { label: '金额单位', defaultValue: 'yuan', required: true }),
    revenue_amount: amount('营业收入'),
    operating_cost: amount('营业成本'),
    period_expense: amount('期间费用'),
    gross_profit: amount('毛利润'),
    operating_profit: amount('营业利润'),
    total_profit: amount('利润总额'),
    income_tax: amount('所得税费用'),
    net_profit: amount('净利润'),
    source_snapshot: Field.textarea({ label: '来源快照', required: true }),
    generated_at: Field.datetime({ label: '生成时间', required: true }),
    closed_at: Field.datetime({ label: '关账时间' }),
    status: Field.select([
      { value: 'preview', label: '未关账' }, { value: 'closed', label: '已关账' },
    ], { label: '期间状态', defaultValue: 'preview', required: true }),
    reason: Field.text({ label: '生成原因', defaultValue: '业务更新' }),
  },
  listViews: { all: { label: '全部版本', type: 'grid', columns: ['code', 'accounting_period', 'organization_name', 'revenue_amount', 'operating_cost', 'net_profit', 'status', 'generated_at', 'closed_at'] } },
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});
