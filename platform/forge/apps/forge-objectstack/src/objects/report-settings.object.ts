import { Field, ObjectSchema } from '@objectstack/spec/data';
import { required } from '../model.js';

/**
 * One organization-owned default template per report type. The generated
 * report-version object remains the immutable output snapshot; this object
 * stores only the template and the values used to initialize a report query.
 */
export const ReportTemplate = ObjectSchema.create({
  name: 'forge_report_template',
  label: '报表默认模板',
  pluralLabel: '报表默认模板',
  description: '按组织维护各报表的默认期间和展示口径；每种报表一份，不保存报表输出快照。',
  icon: 'file-chart-column',
  sharingModel: 'private',
  nameField: 'name',
  searchableFields: ['name'],
  fields: {
    name: Field.text({ label: '模板名称', maxLength: 120, ...required }),
    report_key: Field.select([
      { value: 'management_profit_report', label: '管理利润表' },
    ], { label: '适用报表', defaultValue: 'management_profit_report', ...required }),
    default_period: Field.date({ label: '默认会计期间（按月份生效）', ...required }),
    default_dimension: Field.select([
      { value: 'company', label: '公司' },
      { value: 'project', label: '项目' },
      { value: 'department', label: '部门' },
    ], { label: '默认统计维度', defaultValue: 'company', ...required }),
    default_compare_basis: Field.select([
      { value: 'year_on_year', label: '同期对比' },
      { value: 'none', label: '不对比' },
    ], { label: '默认对比口径', defaultValue: 'year_on_year', ...required }),
    default_currency: Field.select([
      { value: 'cny', label: '人民币（CNY，本位币）' },
    ], { label: '默认展示币种', defaultValue: 'cny', ...required }),
    default_amount_unit: Field.select([
      { value: 'yuan', label: '元' },
      { value: 'ten_thousand', label: '万元' },
    ], { label: '默认金额单位', defaultValue: 'yuan', ...required }),
    enabled: Field.boolean({ label: '启用', defaultValue: true }),
  },
  listViews: {
    all: {
      label: '报表默认模板',
      type: 'grid',
      columns: ['name', 'report_key', 'default_period', 'default_dimension', 'default_compare_basis', 'default_currency', 'default_amount_unit', 'enabled'],
    },
  },
  indexes: [{ fields: ['report_key'], unique: 'organization' }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});
