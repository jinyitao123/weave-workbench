import { Field, ObjectSchema } from '@objectstack/spec/data';
import { required } from '../model.js';

export const BusinessSettingOption = ObjectSchema.create({
  name: 'forge_business_setting_option',
  label: '业务设置项',
  pluralLabel: '业务设置项',
  description: '财务、行政、人事及其他业务模块共用的可维护设置项',
  icon: 'sliders-horizontal',
  sharingModel: 'private',
  nameField: 'name',
  searchableFields: ['name', 'code', 'scope', 'setting_type', 'description'],
  fields: {
    name: Field.text({ label: '名称', maxLength: 120, ...required }),
    code: Field.text({ label: '编码', maxLength: 100, ...required }),
    scope: Field.text({ label: '业务范围', maxLength: 80, ...required }),
    setting_type: Field.text({ label: '设置类型', maxLength: 80, ...required }),
    parent_code: Field.text({ label: '上级编码', maxLength: 100 }),
    option_value: Field.text({ label: '选项值', maxLength: 100 }),
    icon_name: Field.text({ label: '图标', maxLength: 80 }),
    color: Field.text({ label: '主题色', maxLength: 30 }),
    description: Field.textarea({ label: '说明', maxLength: 500 }),
    enabled: Field.boolean({ label: '启用', defaultValue: true }),
    system_record: Field.boolean({ label: '系统预置', defaultValue: false }),
    sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 100 }),
  },
  listViews: {
    all: { label: '全部设置项', type: 'grid', columns: ['name', 'code', 'scope', 'setting_type', 'parent_code', 'enabled', 'sort_order'] },
  },
  indexes: [
    { fields: ['scope', 'setting_type', 'sort_order'] },
    { fields: ['code'], unique: 'organization' },
  ],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});

export const MeetingRoom = ObjectSchema.create({
  name: 'forge_meeting_room',
  label: '会议室',
  pluralLabel: '会议室',
  description: '行政日程预约使用的会议室主数据',
  icon: 'map-pin',
  sharingModel: 'private',
  nameField: 'name',
  searchableFields: ['name', 'location', 'description'],
  fields: {
    name: Field.text({ label: '会议室名称', maxLength: 120, ...required }),
    location: Field.text({ label: '位置', maxLength: 200, ...required }),
    capacity: Field.number({ label: '容量', min: 1, scale: 0, ...required }),
    enabled: Field.boolean({ label: '启用', defaultValue: true }),
    description: Field.textarea({ label: '备注', maxLength: 500 }),
  },
  listViews: { all: { label: '全部会议室', type: 'grid', columns: ['name', 'location', 'capacity', 'enabled'] } },
  indexes: [{ fields: ['name'], unique: 'organization' }, { fields: ['enabled', 'capacity'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});

export const HrLeaveConfig = ObjectSchema.create({
  name: 'forge_hr_leave_config',
  label: '请假配置',
  pluralLabel: '请假配置',
  description: '请假最小单位与跨时段处理规则',
  icon: 'settings',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: Field.text({ label: '配置名称', maxLength: 80, ...required }),
    minimum_minutes: Field.number({ label: '最小请假单位', min: 15, scale: 0, defaultValue: 30, ...required }),
    deduct_lunch: Field.boolean({ label: '跨午休自动扣减', defaultValue: false }),
    cross_shift_strategy: Field.text({ label: '跨班次处理策略', maxLength: 100, defaultValue: '按起始日班次', ...required }),
  },
  indexes: [{ fields: ['name'], unique: 'organization' }],
  enable: { apiEnabled: true, searchable: false, trackHistory: true, feeds: false, activities: false },
});

export const HrSalaryItem = ObjectSchema.create({
  name: 'forge_hr_salary_item',
  label: '工资项',
  pluralLabel: '工资项',
  description: '工资条模板中的收入项与扣款项',
  icon: 'badge-dollar-sign',
  sharingModel: 'private',
  nameField: 'name',
  searchableFields: ['name', 'code'],
  fields: {
    code: Field.text({ label: '编码', maxLength: 80, ...required }),
    name: Field.text({ label: '名称', maxLength: 120, ...required }),
    item_type: Field.select({ label: '类型', options: [{ label: '收入', value: 'income' }, { label: '扣款', value: 'deduction' }], defaultValue: 'income', ...required }),
    required_item: Field.boolean({ label: '必填', defaultValue: false }),
    enabled: Field.boolean({ label: '启用', defaultValue: true }),
    sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 }),
  },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['item_type', 'sort_order'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});
