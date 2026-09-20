import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect } from './api-client.mjs';

export const snapshotPath = fileURLToPath(new URL('../../../docs/standard-test-data/risemap-oem-v0.1-observed-master-data.json', import.meta.url));
export async function seedReferenceData() {
  const fixture = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const api = await connect();
  const ids = { operator: api.userId };
  const results = [];
  for (const entry of fixture.records) {
    const data = Object.fromEntries(Object.entries(entry.data).map(([field, value]) => {
      if (value && typeof value === 'object' && '$ref' in value) {
        if (!ids[value.$ref]) throw new Error(`Missing fixture dependency: ${value.$ref}`);
        return [field, ids[value.$ref]];
      }
      return [field, value];
    }));
    const query = new URLSearchParams({ $filter: JSON.stringify({ [entry.matchField]: data[entry.matchField] }), $top: '100' });
    const list = await api.request(`/data/${entry.object}?${query}`);
    if (list.status !== 200) throw new Error(`Read failed ${entry.object}: ${JSON.stringify(list)}`);
    const matches = list.value.records.filter(record => record[entry.matchField] === data[entry.matchField]);
    const selectedMatch = matches[0];
    const result = matches.length
      ? await api.request(`/data/${entry.object}/${selectedMatch.id}`, 'PATCH', data)
      : await api.request(`/data/${entry.object}`, 'POST', data);
    if (result.status < 200 || result.status >= 300) throw new Error(`Write failed ${entry.key}: ${JSON.stringify(result)}`);
    ids[entry.key] = result.value.id || result.value.record?.id || result.value.data?.id || result.value.data?.record?.id || selectedMatch?.id;
    if (!ids[entry.key]) throw new Error(`Missing saved ID: ${entry.key}`);
    results.push({ key: entry.key, object: entry.object, id: ids[entry.key], evidence: entry.evidence, operation: matches.length ? 'update' : 'create', duplicateMatches: matches.length > 1 ? matches.map(record => record.id) : undefined });
  }
  const prerequisiteSeeds = [
    ['payment_condition_monthly_30','forge_payment_condition',{name:'月结 30 天',code:'PAY-MONTHLY-30',settlement_basis:'inventory_inbound',payment_days:30,status:'active',description:'确认入库后起算，30 天内完成付款。'}],
    ['payment_condition_acceptance_30','forge_payment_condition',{name:'验收后 30 天',code:'PAY-ACCEPTANCE-30',settlement_basis:'goods_received',payment_days:30,status:'active',description:'到货验收完成后起算，30 天内完成付款。'}],
    ['other_inbound_type_production','forge_other_inbound_type',{name:'生产验收备料',code:'OIT-PRODUCTION-ACCEPTANCE',status:'active',color:'#245bdb',description:'用于补齐组装验收所需物料，并保留审批、入库和库存流水。'}],
    ['inventory_damage_type','forge_inventory_business_setting',{name:'生产报损',code:'INV-DAMAGE-PRODUCTION',category:'damage_type',enabled:true,color:'#c53b32',description:'生产现场损坏或盘亏物料的报损分类。'}],
    ['inventory_other_outbound_type','forge_inventory_business_setting',{name:'样品出库',code:'INV-OUT-SAMPLE',category:'other_outbound_type',enabled:true,color:'#245bdb',description:'不属于销售、生产和委外发料的样品出库。'}],
    // 报损单页读取 forge_inventory_damage_type；此前只写入了 business_setting，导致类型下拉为空（审计走查 2026-09-18）。
    // RISEMAP 报损单页当前无可办理数据，以下四项是 Forge 产品决策的起步类型，待 RISEMAP 同材料复核。
    ['damage_type_goods_damage','forge_inventory_damage_type',{name:'商品损坏',code:'DMG-TYPE-DAMAGE',status:'active',color:'#c53b32',description:'物料在搬运、存储或生产过程中损坏。'}],
    ['damage_type_lost','forge_inventory_damage_type',{name:'物料丢失',code:'DMG-TYPE-LOSS',status:'active',color:'#b86500',description:'盘点或现场确认的物料丢失。'}],
    ['damage_type_count_loss','forge_inventory_damage_type',{name:'盘亏',code:'DMG-TYPE-COUNT-LOSS',status:'active',color:'#7c3aed',description:'盘点结果小于账面数量形成的盘亏。'}],
    ['damage_type_production','forge_inventory_damage_type',{name:'生产报损',code:'DMG-TYPE-PRODUCTION',status:'active',color:'#c53b32',description:'生产现场损坏或盘亏物料的报损分类。'}],
    // 其他出库页读取 forge_other_outbound_type；同样只写入了 business_setting。
    ['other_outbound_type_sample','forge_other_outbound_type',{name:'样品出库',code:'OOT-SAMPLE',status:'active',color:'#245bdb',description:'不属于销售、生产和委外发料的样品出库。'}],
    ['other_outbound_type_rd','forge_other_outbound_type',{name:'研发领用',code:'OOT-RD',status:'active',color:'#0f766e',description:'研发和试验用物料领用出库。'}],
    ['other_outbound_type_scrap','forge_other_outbound_type',{name:'报废出库',code:'OOT-SCRAP',status:'active',color:'#b42318',description:'已判定报废物料的出库。'}],
    ['other_outbound_type_other','forge_other_outbound_type',{name:'其他',code:'OOT-OTHER',status:'active',color:'#475467',description:'无法归入既有类型的其他出库。'}],
    ['inventory_lock_reason','forge_inventory_business_setting',{name:'生产备料',code:'INV-LOCK-PRODUCTION',category:'lock_reason',enabled:true,color:'#b86500',description:'为已下达生产任务预留可用库存。'}],
    ['inventory_release_reason','forge_inventory_business_setting',{name:'生产计划变更',code:'INV-RELEASE-PLAN-CHANGE',category:'release_reason',enabled:true,color:'#16845b',description:'生产计划调整后释放未使用的库存占用。'}],
    ['inventory_inspection_category','forge_inventory_business_setting',{name:'外观与功能',code:'INV-INSPECTION-AF',category:'inspection_category',enabled:true,color:'#7c3aed',description:'到货检验中的外观和基本功能检查。'}],
    ['inventory_express_company','forge_inventory_business_setting',{name:'顺丰速运',code:'INV-EXPRESS-SF',category:'express_company',enabled:true,color:'#475467',description:'小件物料和文件快递承运方。'}],
    ['inventory_logistics_company','forge_inventory_business_setting',{name:'德邦物流',code:'INV-LOGISTICS-DB',category:'logistics_company',enabled:true,color:'#475467',description:'设备和大件物料运输承运方。'}],
    ['drawing_drawing_type_01','forge_drawing_business_setting',{name:'装配图',code:'DRAW-TYPE-01',category:'drawing_type',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_02','forge_drawing_business_setting',{name:'零件图',code:'DRAW-TYPE-02',category:'drawing_type',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_03','forge_drawing_business_setting',{name:'电气图',code:'DRAW-TYPE-03',category:'drawing_type',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_04','forge_drawing_business_setting',{name:'原理图',code:'DRAW-TYPE-04',category:'drawing_type',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_05','forge_drawing_business_setting',{name:'布置图',code:'DRAW-TYPE-05',category:'drawing_type',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_06','forge_drawing_business_setting',{name:'安装图',code:'DRAW-TYPE-06',category:'drawing_type',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_07','forge_drawing_business_setting',{name:'施工图',code:'DRAW-TYPE-07',category:'drawing_type',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_08','forge_drawing_business_setting',{name:'P&ID图',code:'DRAW-TYPE-08',category:'drawing_type',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_09','forge_drawing_business_setting',{name:'控制图',code:'DRAW-TYPE-09',category:'drawing_type',enabled:true,sort_order:8,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_10','forge_drawing_business_setting',{name:'网络拓扑图',code:'DRAW-TYPE-10',category:'drawing_type',enabled:true,sort_order:9,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_11','forge_drawing_business_setting',{name:'流程图',code:'DRAW-TYPE-11',category:'drawing_type',enabled:true,sort_order:10,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_type_12','forge_drawing_business_setting',{name:'说明书',code:'DRAW-TYPE-12',category:'drawing_type',enabled:true,sort_order:11,color:'#245bdb',description:'RISEMAP 当前图纸类型，用于图号档案。'}],
    ['drawing_drawing_category_01','forge_drawing_business_setting',{name:'机械图',code:'DRAW-CAT-01',category:'drawing_category',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_02','forge_drawing_business_setting',{name:'电气图',code:'DRAW-CAT-02',category:'drawing_category',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_03','forge_drawing_business_setting',{name:'液压图',code:'DRAW-CAT-03',category:'drawing_category',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_04','forge_drawing_business_setting',{name:'气动图',code:'DRAW-CAT-04',category:'drawing_category',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_05','forge_drawing_business_setting',{name:'P&ID图',code:'DRAW-CAT-05',category:'drawing_category',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_06','forge_drawing_business_setting',{name:'土建图',code:'DRAW-CAT-06',category:'drawing_category',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_07','forge_drawing_business_setting',{name:'控制图',code:'DRAW-CAT-07',category:'drawing_category',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_08','forge_drawing_business_setting',{name:'外购件图',code:'DRAW-CAT-08',category:'drawing_category',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_09','forge_drawing_business_setting',{name:'外协件图',code:'DRAW-CAT-09',category:'drawing_category',enabled:true,sort_order:8,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_drawing_category_10','forge_drawing_business_setting',{name:'参考图',code:'DRAW-CAT-10',category:'drawing_category',enabled:true,sort_order:9,color:'#245bdb',description:'RISEMAP 当前图纸归档分类。'}],
    ['drawing_change_type_01','forge_drawing_business_setting',{name:'设计变更',code:'DRAW-CHANGE-01',category:'change_type',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_02','forge_drawing_business_setting',{name:'工艺变更',code:'DRAW-CHANGE-02',category:'change_type',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_03','forge_drawing_business_setting',{name:'材料变更',code:'DRAW-CHANGE-03',category:'change_type',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_04','forge_drawing_business_setting',{name:'规格变更',code:'DRAW-CHANGE-04',category:'change_type',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_05','forge_drawing_business_setting',{name:'客户变更',code:'DRAW-CHANGE-05',category:'change_type',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_06','forge_drawing_business_setting',{name:'采购替代',code:'DRAW-CHANGE-06',category:'change_type',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_07','forge_drawing_business_setting',{name:'紧急变更',code:'DRAW-CHANGE-07',category:'change_type',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_change_type_08','forge_drawing_business_setting',{name:'临时变更',code:'DRAW-CHANGE-08',category:'change_type',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前图纸变更类型。'}],
    ['drawing_version_type_01','forge_drawing_business_setting',{name:'初版(V0.1)',code:'DRAW-VERSION-01',category:'version_type',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_02','forge_drawing_business_setting',{name:'内部评审版(VR1)',code:'DRAW-VERSION-02',category:'version_type',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_03','forge_drawing_business_setting',{name:'客户评审版(A1)',code:'DRAW-VERSION-03',category:'version_type',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_04','forge_drawing_business_setting',{name:'正式版(V1.0)',code:'DRAW-VERSION-04',category:'version_type',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_05','forge_drawing_business_setting',{name:'修订版(V1.x)',code:'DRAW-VERSION-05',category:'version_type',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_06','forge_drawing_business_setting',{name:'终版/归档',code:'DRAW-VERSION-06',category:'version_type',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_07','forge_drawing_business_setting',{name:'临时版',code:'DRAW-VERSION-07',category:'version_type',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_version_type_08','forge_drawing_business_setting',{name:'试制版',code:'DRAW-VERSION-08',category:'version_type',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前版本管理类型。'}],
    ['drawing_review_category_01','forge_drawing_business_setting',{name:'设计评审',code:'DRAW-REVIEW-01',category:'review_category',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_02','forge_drawing_business_setting',{name:'工艺评审',code:'DRAW-REVIEW-02',category:'review_category',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_03','forge_drawing_business_setting',{name:'安全评审',code:'DRAW-REVIEW-03',category:'review_category',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_04','forge_drawing_business_setting',{name:'质量评审',code:'DRAW-REVIEW-04',category:'review_category',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_05','forge_drawing_business_setting',{name:'成本评审',code:'DRAW-REVIEW-05',category:'review_category',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_06','forge_drawing_business_setting',{name:'可靠性评审',code:'DRAW-REVIEW-06',category:'review_category',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_07','forge_drawing_business_setting',{name:'可制造性评审',code:'DRAW-REVIEW-07',category:'review_category',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_08','forge_drawing_business_setting',{name:'环境评审',code:'DRAW-REVIEW-08',category:'review_category',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_09','forge_drawing_business_setting',{name:'客户评审',code:'DRAW-REVIEW-09',category:'review_category',enabled:true,sort_order:8,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_review_category_10','forge_drawing_business_setting',{name:'综合评审',code:'DRAW-REVIEW-10',category:'review_category',enabled:true,sort_order:9,color:'#245bdb',description:'RISEMAP 当前评审分类。'}],
    ['drawing_issue_category_01','forge_drawing_business_setting',{name:'尺寸',code:'DRAW-ISSUE-01',category:'issue_category',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_02','forge_drawing_business_setting',{name:'干涉',code:'DRAW-ISSUE-02',category:'issue_category',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_03','forge_drawing_business_setting',{name:'工艺',code:'DRAW-ISSUE-03',category:'issue_category',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_04','forge_drawing_business_setting',{name:'材料',code:'DRAW-ISSUE-04',category:'issue_category',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_05','forge_drawing_business_setting',{name:'标准',code:'DRAW-ISSUE-05',category:'issue_category',enabled:true,sort_order:4,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_06','forge_drawing_business_setting',{name:'可采购',code:'DRAW-ISSUE-06',category:'issue_category',enabled:true,sort_order:5,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_07','forge_drawing_business_setting',{name:'装配',code:'DRAW-ISSUE-07',category:'issue_category',enabled:true,sort_order:6,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_08','forge_drawing_business_setting',{name:'风险',code:'DRAW-ISSUE-08',category:'issue_category',enabled:true,sort_order:7,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_09','forge_drawing_business_setting',{name:'标注',code:'DRAW-ISSUE-09',category:'issue_category',enabled:true,sort_order:8,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_category_10','forge_drawing_business_setting',{name:'其他',code:'DRAW-ISSUE-10',category:'issue_category',enabled:true,sort_order:9,color:'#245bdb',description:'RISEMAP 当前评审问题分类。'}],
    ['drawing_issue_severity_01','forge_drawing_business_setting',{name:'致命(P0/阻塞)',code:'DRAW-SEVERITY-01',category:'issue_severity',enabled:true,sort_order:0,color:'#245bdb',description:'RISEMAP 当前问题严重度。'}],
    ['drawing_issue_severity_02','forge_drawing_business_setting',{name:'严重(P1)',code:'DRAW-SEVERITY-02',category:'issue_severity',enabled:true,sort_order:1,color:'#245bdb',description:'RISEMAP 当前问题严重度。'}],
    ['drawing_issue_severity_03','forge_drawing_business_setting',{name:'一般(P2)',code:'DRAW-SEVERITY-03',category:'issue_severity',enabled:true,sort_order:2,color:'#245bdb',description:'RISEMAP 当前问题严重度。'}],
    ['drawing_issue_severity_04','forge_drawing_business_setting',{name:'建议(P3)',code:'DRAW-SEVERITY-04',category:'issue_severity',enabled:true,sort_order:3,color:'#245bdb',description:'RISEMAP 当前问题严重度。'}],
    ['drawing_change_level','forge_drawing_business_setting',{name:'一般变更',code:'DRAW-LEVEL-NORMAL',category:'change_level',enabled:false,color:'#98a2b3',description:'RISEMAP 当前环境暂无变更等级配置，本地示例已停用。'}],
    ['drawing_participant_role','forge_drawing_business_setting',{name:'工艺工程师',code:'DRAW-ROLE-PROCESS',category:'participant_role',enabled:false,color:'#98a2b3',description:'RISEMAP 当前环境暂无参与人角色配置，本地示例已停用。'}],
    ['subcontract_dictionary','forge_subcontract_business_setting',{name:'通用委外',code:'SUB-DICT-GENERAL',category:'dictionary',enabled:true,color:'#245bdb',description:'常规外协加工业务分类。'}],
    ['subcontract_process_type','forge_subcontract_business_setting',{name:'机加工',code:'SUB-PROCESS-MACHINING',category:'process_type',enabled:true,color:'#245bdb',description:'车、铣、钻等机械加工。'}],
    ['subcontract_process_type_marking','forge_subcontract_business_setting',{name:'激光打标',code:'SUB-PROCESS-MARKING',category:'process_type',enabled:true,color:'#0891b2',description:'激光标识加工。'}],
    ['subcontract_process_type_bending','forge_subcontract_business_setting',{name:'钣金折弯、喷涂',code:'SUB-PROCESS-BENDING-COATING',category:'process_type',enabled:true,color:'#7c3aed',description:'钣金折弯与表面喷涂。'}],
    ['subcontract_return_reason','forge_subcontract_business_setting',{name:'余料退回',code:'SUB-RETURN-SURPLUS',category:'return_reason',enabled:true,color:'#16845b',description:'供应商完成加工后退回未消耗物料。'}],
    ['subcontract_return_reason_change','forge_subcontract_business_setting',{name:'工程变更',code:'SUB-RETURN-CHANGE',category:'return_reason',enabled:true,color:'#245bdb',description:'工程变更导致物料退回。'}],
    ['subcontract_return_reason_scrap','forge_subcontract_business_setting',{name:'可用废料回收',code:'SUB-RETURN-REUSABLE',category:'return_reason',enabled:true,color:'#b86500',description:'仍可利用的余料或废料回收入库。'}],
    ['subcontract_return_reason_wrong','forge_subcontract_business_setting',{name:'错发退回',code:'SUB-RETURN-WRONG',category:'return_reason',enabled:true,color:'#c53b32',description:'错发物料退回。'}],
    ['subcontract_return_reason_other','forge_subcontract_business_setting',{name:'其他',code:'SUB-RETURN-OTHER',category:'return_reason',enabled:true,color:'#475467',description:'其他已说明的退料原因。'}],
    ['subcontract_rule','forge_subcontract_business_setting',{name:'发料不得超过计划',code:'SUB-RULE-ISSUE-LIMIT',category:'rule',value:'按委外订单发料计划控制',enabled:true,color:'#b86500',description:'累计发料不得超过订单计划数量，超耗补料需独立办理。'}],
    ['subcontract_alert','forge_subcontract_business_setting',{name:'交期预警',code:'SUB-ALERT-DELIVERY',category:'alert_threshold',value:'2天',enabled:true,color:'#c53b32',description:'期望交期前两天仍未完成回厂时提醒经办人。'}],
    ['subcontract_strategy','forge_subcontract_business_setting',{name:'按合格回厂数量结算',code:'SUB-STRATEGY-SETTLEMENT',category:'strategy',value:'合格数量',enabled:true,color:'#7c3aed',description:'加工费以验收合格并完成入库的数量为结算依据。'}],
    ['production_disassembly_reason','forge_production_disassembly_reason',{name:'质量返工',code:'PROD-DISASSEMBLY-REWORK',enabled:true,color:'#c53b32',sort_order:0,description:'成品质量异常后拆解返工。'}],
    ['production_replacement_reason','forge_production_replacement_reason',{name:'客户要求改制',code:'PROD-REPLACEMENT-CUSTOMER',enabled:true,color:'#b86500',sort_order:0,description:'按客户变更要求更换部件或调整配置。'}],
  ];
  for (const [key, object, data] of prerequisiteSeeds) {
    const query = new URLSearchParams({ $filter: JSON.stringify({ code: data.code }), $top: '10' });
    const list = await api.request(`/data/${object}?${query}`);
    if (list.status !== 200) throw new Error(`Read failed ${object}: ${JSON.stringify(list)}`);
    const match = list.value.records.find(record => record.code === data.code);
    const result = match ? await api.request(`/data/${object}/${match.id}`, 'PATCH', data) : await api.request(`/data/${object}`, 'POST', data);
    if (result.status < 200 || result.status >= 300) throw new Error(`Write failed ${key}: ${JSON.stringify(result)}`);
    ids[key] = result.value.id || result.value.record?.id || match?.id;
    results.push({ key, object, id: ids[key], evidence: 'RISEMAP business-setting category observed; local seed is Forge reference data', operation: match ? 'update' : 'create' });
  }
  await mkdir('.objectstack/acceptance', { recursive: true });
  await writeFile('.objectstack/acceptance/reference-data.json', JSON.stringify({ fixtureId: fixture.fixtureId, seededAt: new Date().toISOString(), results }, null, 2));
  return { api, fixture, ids, results };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { results } = await seedReferenceData();
  console.log(`Reference data saved: ${results.length} linked records. IDs saved locally; no credentials written.`);
}
