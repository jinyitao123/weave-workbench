import { defineSeed } from '@objectstack/spec/data';
import { BusinessSettingOption, HrLeaveConfig } from '../objects/business-setting.object.js';
import { DrawingBusinessSetting } from '../objects/production-prerequisite.object.js';

const paymentMethods = ['银行转账', '支付宝', '微信支付', '现金', '支票', '其他', '电汇', '承兑汇票', '在线支付', '信用证'];
const expenseCategories: Array<[string, string, string | null, number]> = [
  ['sales_expense', '销售费用', null, 100],
  ['customer_development', '客户开发费用', 'sales_expense', 110], ['customer_visit', '客户拜访费', 'customer_development', 111], ['customer_entertainment', '客户招待费', 'customer_development', 112], ['customer_gift', '客户礼品费', 'customer_development', 113],
  ['market_promotion', '市场推广费用', 'sales_expense', 120], ['advertising', '广告推广费', 'market_promotion', 121], ['exhibition', '展会活动费', 'market_promotion', 122], ['promotion_material', '宣传物料费', 'market_promotion', 123],
  ['sales_support', '销售支持费用', 'sales_expense', 130], ['sample', '样品费', 'sales_support', 131], ['presales_support', '售前支持费', 'sales_support', 132], ['sales_commission', '销售佣金', 'sales_support', 133],
  ['project_expense', '项目费用', null, 200],
  ['project_travel', '项目差旅费用', 'project_expense', 210], ['project_transportation', '项目交通费', 'project_travel', 211], ['project_accommodation', '项目住宿费', 'project_travel', 212], ['project_meal_allowance', '项目餐饮补贴', 'project_travel', 213],
  ['project_implementation', '项目实施费用', 'project_expense', 220], ['installation_debugging', '安装调试费', 'project_implementation', 221], ['site_construction', '现场施工费', 'project_implementation', 222], ['temporary_labor', '临时用工费', 'project_implementation', 223],
  ['project_material', '项目材料费用', 'project_expense', 230], ['project_auxiliary_material', '项目辅材费', 'project_material', 231], ['project_consumables', '项目耗材费', 'project_material', 232], ['project_replenishment', '项目补料费', 'project_material', 233],
  ['project_outsource', '项目外协费用', 'project_expense', 240], ['outsourced_processing', '外协加工费', 'project_outsource', 241], ['outsourced_service', '外包服务费', 'project_outsource', 242], ['external_technical_support', '外部技术支持费', 'project_outsource', 243],
  ['procurement_expense', '采购费用', null, 300],
  ['procurement_business', '采购业务费用', 'procurement_expense', 310], ['supplier_visit', '供应商拜访费', 'procurement_business', 311], ['supplier_entertainment', '供应商招待费', 'procurement_business', 312], ['supplier_inspection', '供应商考察费', 'procurement_business', 313],
  ['procurement_logistics', '采购物流费用', 'procurement_expense', 320], ['procurement_transportation', '采购运输费', 'procurement_logistics', 321], ['loading_handling', '装卸搬运费', 'procurement_logistics', 322], ['packaging', '包装费', 'procurement_logistics', 323],
  ['quality_handling', '质量处理费用', 'procurement_expense', 330], ['incoming_inspection', '来料检测费', 'quality_handling', 331], ['rework_handling', '返修处理费', 'quality_handling', 332], ['return_transportation', '退货运输费', 'quality_handling', 333],
  ['rd_expense', '研发费用', null, 400],
  ['rd_material', '研发材料费用', 'rd_expense', 410], ['rd_material_cost', '研发材料费', 'rd_material', 411], ['rd_prototyping', '研发打样费', 'rd_material', 412], ['rd_test_piece', '研发测试件费用', 'rd_material', 413],
  ['rd_testing', '研发测试费用', 'rd_expense', 420], ['test_inspection', '测试检测费', 'rd_testing', 421], ['certification_calibration', '认证校准费', 'rd_testing', 422], ['experiment', '实验费用', 'rd_testing', 423],
  ['rd_service', '研发服务费用', 'rd_expense', 430], ['technical_consulting', '技术咨询费', 'rd_service', 431], ['outsourced_development', '外包开发费', 'rd_service', 432], ['intellectual_property', '知识产权费', 'rd_service', 433],
  ['admin_expense', '行政办公费用', null, 500],
  ['office_supplies', '办公用品费用', 'admin_expense', 510], ['office_supply_cost', '办公用品费', 'office_supplies', 511], ['office_consumables', '办公耗材费', 'office_supplies', 512], ['office_equipment', '办公设备费', 'office_supplies', 513],
  ['office_site', '办公场地费用', 'admin_expense', 520], ['rent_property', '房租物业费', 'office_site', 521], ['utilities', '水电费', 'office_site', 522], ['renovation_maintenance', '装修维修费', 'office_site', 523],
  ['daily_admin', '日常行政费用', 'admin_expense', 530], ['courier', '快递费', 'daily_admin', 531], ['printing', '印刷费', 'daily_admin', 532], ['meeting', '会议费', 'daily_admin', 533],
  ['hr_expense', '人事费用', null, 600],
  ['recruitment_expense', '招聘费用', 'hr_expense', 610], ['recruitment_platform', '招聘平台费', 'recruitment_expense', 611], ['headhunting', '猎头费', 'recruitment_expense', 612], ['interview', '面试费用', 'recruitment_expense', 613],
  ['training_expense', '培训费用', 'hr_expense', 620], ['internal_training', '内部培训费', 'training_expense', 621], ['external_training', '外部培训费', 'training_expense', 622], ['course', '课程费用', 'training_expense', 623],
  ['employee_welfare', '员工福利费用', 'hr_expense', 630], ['holiday_welfare', '节日福利费', 'employee_welfare', 631], ['team_building', '团建费', 'employee_welfare', 632], ['employee_care', '员工关怀费', 'employee_welfare', 633],
  ['finance_legal_expense', '财务法务费用', null, 700],
  ['finance_service', '财务服务费用', 'finance_legal_expense', 710], ['bookkeeping_agency', '代理记账费', 'finance_service', 711], ['tax_service', '税务服务费', 'finance_service', 712], ['audit_evaluation', '审计评估费', 'finance_service', 713],
  ['bank_finance', '银行金融费用', 'finance_legal_expense', 720], ['bank_fee', '银行手续费', 'bank_finance', 721], ['acceptance_fee', '承兑手续费', 'bank_finance', 722], ['financing_service', '融资服务费', 'bank_finance', 723],
  ['legal_compliance', '法务合规费用', 'finance_legal_expense', 730], ['lawyer', '律师费', 'legal_compliance', 731], ['contract_review', '合同审查费', 'legal_compliance', 732],
];

const administrationSettings: Array<[string, string, string[]]> = [
  ['asset_category', 'asset', ['软件/无形资产', '其他', '电子设备(IT)', '房屋建筑', '办公家具', '检测/仪器仪表', '交通工具', '生产设备', '办公设备']],
  ['material_category', 'material', ['五金工具', '办公用品', '食品饮品', '礼品/福利物料', '清洁用品', '宣传物料', '文具耗材', '电子设备/IT耗材', '劳保用品', '其他']],
  ['purchase_channel', 'purchase', ['拼多多企业版', '1688批发', '线下门店', '京东企业购', '淘宝/天猫', '内部调拨', '其他', '供应商直送', '海外采购', '苏宁易购']],
  ['welfare_category', 'welfare', ['实物礼品', '兑换券码', '充值卡', '现金红包', '报销额度', '生日福利', '节日福利(春节/端午/中秋)', '司庆福利', '入职周年', '婚育福利', '高温/防寒福利', '体检福利', '团建福利']],
  ['meeting_type', 'meeting', ['项目会议', '经营分析', '技术评审', '部门例会', '全体大会', '专题讨论', '客户会议', '供应商会议', '培训会议', '面试招聘']],
  ['declaration_category', 'declaration', ['高新技术企业', '专精特新', '科技型中小企业', 'ISO体系认证', '安全生产标准化', '研发费用加计扣除', '技改补贴', '研发补贴', '示范项目', '创新基金', '知识产权(专利/商标/版权)', '其他']],
  ['declaration_stage', 'stage', ['待评估', '准备材料', '已提交', '形式审查', '专家评审', '公示中', '已立项', '补材料中', '已拨付', '已驳回']],
];

const hrSettings: Array<[string, string[]]> = [
  ['correction_type', ['上班补签', '下班补签', '上下班补签', '外勤补签', '出差补签', '加班补签', '夜班/跨天补签', '排班异常补签', '系统/设备异常补签', '管理员修正补签']],
  ['shift_type', ['常白班', '早班', '中班', '夜班', '两班倒', '三班倒', '综合工时', '弹性工时']],
  ['holiday_type', ['法定节假日', '周末双休', '调休工作日', '公司福利假', '地区性假日', '临时停工日']],
  ['recruitment_channel', ['BOSS直聘', '智联招聘', '前程无忧', '猎聘网', '拉勾网', '脉脉', '领英', '猎头服务', '内部推荐', '校园招聘', '线下招聘会', '官网投递', '其他']],
  ['handbook_category', ['入职指南', '行为规范', '公司概况', '培训发展', '薪酬福利', '离职指南', '报销流程', '考勤与假期', 'IT使用指南', '安全生产', '办公协作']],
  ['policy_category', ['信息安全', '保密制度', '知识产权', '财务制度', '人事制度', '商务合规', '行政管理', '销售管理', '采购管理', '安全管理', '质量管理', '技术研发']],
];

const projectSettings: Array<[string, string[]]> = [
  ['project_role', ['项目经理', '硬件工程师', '技术负责人', '软件工程师', '质量工程师', '客户对接人', '测试工程师', '产品经理', '实习生', 'UI设计师', '文档管理', '采购协调', '外部顾问']],
  ['task_type', ['方案设计', '测试验证', '文档编写', '培训交付', '问题处理', '沟通协调', '评审会议', '开发实施', '其他', '外部协调', '需求分析']],
  ['idle_category', ['等待返工', '内部会议', '设备故障', '培训学习', '文档整理', '缺料停工', '待命', '其他停工', '客户接待', '行政事务']],
  ['timesheet_type', ['培训工时', '外协工时', '调休工时', '请假工时', '会议工时', '出差工时', '正常工时', '加班工时']],
  ['log_type', ['变更记录', '问题反馈', '日常进展', '决策记录', '阶段总结', '风险预警', '里程碑达成', '内部讨论', '外部协调', '客户沟通']],
  ['plan_template_category', ['默认分类']],
];

const drawingSettings: Array<[string, string[]]> = [
  ['drawing_type', ['装配图', '零件图', '电气图', '原理图', '布置图', '安装图', '施工图', 'P&ID图', '控制图', '网络拓扑图', '流程图', '说明书']],
  ['drawing_category', ['机械图', '电气图', '液压图', '气动图', 'P&ID图', '土建图', '控制图', '外购件图', '外协件图', '参考图']],
  ['change_type', ['设计变更', '工艺变更', '材料变更', '规格变更', '客户变更', '采购替代', '紧急变更', '临时变更']],
  ['version_type', ['初版(V0.1)', '内部评审版(VR1)', '客户评审版(A1)', '正式版(V1.0)', '修订版(V1.x)', '终版/归档', '临时版', '试制版']],
  ['review_category', ['设计评审', '工艺评审', '安全评审', '质量评审', '成本评审', '可靠性评审', '可制造性评审', '环境评审', '客户评审', '综合评审']],
  ['issue_category', ['尺寸', '干涉', '工艺', '材料', '标准', '可采购', '装配', '风险', '标注', '其他']],
  ['issue_severity', ['致命(P0/阻塞)', '严重(P1)', '一般(P2)', '建议(P3)']],
];
const drawingCodePrefixes: Record<string, string> = {
  drawing_type: 'DRAW-TYPE', drawing_category: 'DRAW-CAT', change_type: 'DRAW-CHANGE',
  version_type: 'DRAW-VERSION', review_category: 'DRAW-REVIEW', issue_category: 'DRAW-ISSUE',
  issue_severity: 'DRAW-SEVERITY',
};

export const BusinessSettingSeed = defineSeed(BusinessSettingOption, {
  externalId: 'code',
  // These rows become tenant-owned configuration after bootstrap. Reapplying
  // authored defaults would undo page edits and recreate deleted options.
  mode: 'ignore',
  records: [
    ...paymentMethods.map((name, index) => ({ name, code: `finance_payment_${index + 1}`, scope: 'finance', setting_type: 'payment_method', description: `${name}付款方式`, enabled: true, system_record: true, sort_order: (index + 1) * 10 })),
    ...expenseCategories.map(([code, name, parent_code, sort_order]) => ({ name, code: `finance_expense_${code}`, scope: 'finance', setting_type: 'expense_category', parent_code: parent_code ? `finance_expense_${parent_code}` : null, description: `${name}分类`, enabled: true, system_record: true, sort_order })),
    ...administrationSettings.flatMap(([setting_type, codePrefix, names]) => names.map((name, index) => ({ name, code: `administration_${codePrefix}_${index + 1}`, scope: 'administration', setting_type, description: `${name}${setting_type === 'meeting_type' ? '会议类型' : '行政配置'}`, enabled: true, system_record: true, sort_order: (index + 1) * 10 }))),
    ...hrSettings.flatMap(([setting_type, names]) => names.map((name, index) => ({ name, code: `hr_${setting_type}_${index + 1}`, scope: 'hr', setting_type, option_value: ['correction_type', 'shift_type', 'holiday_type'].includes(setting_type) ? String(index) : null, icon_name: ['handbook_category', 'policy_category'].includes(setting_type) ? 'file-text' : null, color: ['handbook_category', 'policy_category'].includes(setting_type) ? '#0052CC' : null, description: null, enabled: true, system_record: true, sort_order: index + 1 }))),
    ...projectSettings.flatMap(([setting_type, names]) => names.map((name, index) => ({ name, code: `project_${setting_type}_${index + 1}`, scope: 'project', setting_type, color: ['task_type', 'log_tag'].includes(setting_type) ? ['#0052CC', '#36B37E', '#6554C0', '#FF8B00'][index % 4] : null, description: setting_type === 'project_role' ? JSON.stringify({ permissions: {} }) : null, enabled: true, system_record: setting_type === 'project_role' ? index === 0 : setting_type === 'plan_template_category', sort_order: index + 1 }))),
  ],
});

export const HrLeaveConfigSeed = defineSeed(HrLeaveConfig, {
  externalId: 'name',
  // Preserve the administrator's saved rule across process restarts.
  mode: 'ignore',
  records: [{ name: '全局请假规则', minimum_minutes: 30, deduct_lunch: false, cross_shift_strategy: '按起始日班次' }],
});

export const DrawingBusinessSettingSeed = defineSeed(DrawingBusinessSetting, {
  externalId: 'code',
  // Mirror the currently visible RISEMAP defaults once, then preserve tenant edits.
  mode: 'ignore',
  records: drawingSettings.flatMap(([category, names]) => names.map((name, index) => ({
    name,
    code: `${drawingCodePrefixes[category]}-${String(index + 1).padStart(2, '0')}`,
    category,
    description: null,
    color: '#245bdb',
    enabled: true,
    sort_order: index,
  }))),
});
