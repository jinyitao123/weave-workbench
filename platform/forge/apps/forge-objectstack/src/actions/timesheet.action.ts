import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const ProjectRecordTimesheet = defineAction({
  name: 'project_record_timesheet', label: '填报项目工时', objectName: 'forge_project', icon: 'clock-3', locations: [...locations], order: 100,
  visible: `record.status != 'settled' && record.status != 'terminated' && record.status != 'archived'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_project_timesheet', required: true }, { field: 'worker_id', objectOverride: 'forge_project_timesheet', required: true },
    { field: 'work_item_id', objectOverride: 'forge_project_timesheet' }, { field: 'work_on', objectOverride: 'forge_project_timesheet', required: true },
    { field: 'work_content', objectOverride: 'forge_project_timesheet', required: true }, { field: 'time_type', objectOverride: 'forge_project_timesheet', required: true, defaultValue: 'normal' },
    { field: 'hours', objectOverride: 'forge_project_timesheet', required: true }, { field: 'hourly_rate', objectOverride: 'forge_project_timesheet', required: true },
    { field: 'remarks', objectOverride: 'forge_project_timesheet' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/page_project_timesheet_cost?timesheet=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const projectId=ctx.recordId||(ctx.record&&ctx.record.id),project=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!projectId||!project)throw new Error('当前项目不存在或不可访问');if(!actor)throw new Error('无法识别当前填报人');if(['settled','terminated','archived'].includes(project.status))throw new Error('已结算、已终止或已归档项目不可填报工时');const hours=Number(ctx.input.hours||0),rate=Number(ctx.input.hourly_rate||0);if(!(hours>=0.25&&hours<=24))throw new Error('单条工时必须在0.25至24小时之间');if(!(rate>=0))throw new Error('工时费率不得小于0');if(!ctx.input.work_content||!String(ctx.input.work_content).trim())throw new Error('工作内容不能为空');if(ctx.input.work_item_id){const item=await ctx.api.object('forge_project_work_item').findOne({where:{id:ctx.input.work_item_id}});if(!item||item.project_id!==projectId)throw new Error('关联任务必须属于当前项目');}const round2=v=>Math.round((v+Number.EPSILON)*100)/100,cost=round2(hours*rate),created=await ctx.api.object('forge_project_timesheet').insert({name:project.code+' '+ctx.input.work_on+' 工时',code:ctx.input.code,project_id:projectId,work_item_id:ctx.input.work_item_id||null,worker_id:ctx.input.worker_id,work_on:ctx.input.work_on,work_content:String(ctx.input.work_content).trim(),time_type:ctx.input.time_type||'normal',hours,hourly_rate:rate,cost_amount:cost,status:'draft',responsible_id:project.manager_id,remarks:ctx.input.remarks||null}),id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!id)throw new Error('工时记录创建后未返回ID');return{id,project_id:projectId,status:'draft',hours,hourly_rate:rate,cost_amount:cost};
` },
});

export const ProjectTimesheetSubmit = defineAction({
  name: 'project_timesheet_submit', label: '提交审核', objectName: 'forge_project_timesheet', icon: 'send', locations: [...locations], order: 10, visible: `record.status == 'draft'`, refreshAfter: true,
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!record)throw new Error('工时记录不存在或不可访问');if(!actor)throw new Error('无法识别当前提交人');if(record.status!=='draft')throw new Error('仅草稿工时可以提交');await ctx.api.object('forge_project_timesheet').update({id,status:'pending_review',submitted_at:new Date().toISOString()});return{id,status:'pending_review'};` },
});

export const ProjectTimesheetApprove = defineAction({
  name: 'project_timesheet_approve', label: '审核通过', objectName: 'forge_project_timesheet', icon: 'badge-check', locations: [...locations], order: 20, visible: `record.status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'review_comment', objectOverride: 'forge_project_timesheet', required: true }],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/page_project_timesheet_cost?timesheet=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.review_comment||'').trim();if(ctx.recordLoadDenied===true||!id||!record)throw new Error('工时记录不存在或不可访问');if(!actor)throw new Error('无法识别当前审核人');if(!comment)throw new Error('审核意见不能为空');if(record.status!=='pending_review')throw new Error('仅待审核工时可以审核');const project=await ctx.api.object('forge_project').findOne({where:{id:record.project_id}});if(!project)throw new Error('关联项目不存在');if(['settled','terminated','archived'].includes(project.status))throw new Error('项目已结算或关闭，不能再增加人工成本');const existing=await ctx.api.object('forge_project_cost_entry').find({where:{source_id:id,source_type:'timesheet'}});if(existing.some(x=>x.status!=='reversed'))throw new Error('当前工时已经生成成本记录');const amount=Number(record.cost_amount||0);if(!(amount>=0))throw new Error('工时成本无效');const now=new Date().toISOString(),created=await ctx.api.object('forge_project_cost_entry').insert({name:project.code+' 人工成本 '+record.code,code:'COST-'+record.code,project_id:project.id,customer_id:project.customer_id,source_type:'timesheet',cost_type:'labor',source_id:id,occurred_on:record.work_on,total_amount:amount,allocated_amount:amount,remaining_amount:0,status:'allocated',responsible_id:project.manager_id,remarks:'由已审核项目工时自动归集'}),costId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!costId)throw new Error('人工成本记录创建后未返回ID');await ctx.api.object('forge_project_timesheet').update({id,status:'approved',reviewed_at:now,reviewer_id:actor,review_comment:comment});const nextCost=Math.round((Number(project.total_cost||0)+amount+Number.EPSILON)*100)/100;await ctx.api.object('forge_project').update({id:project.id,total_cost:nextCost});return{id,status:'approved',cost_entry_id:costId,cost_amount:amount,project_total_cost:nextCost};
` },
});

export const ProjectTimesheetReject = defineAction({
  name: 'project_timesheet_reject', label: '驳回', objectName: 'forge_project_timesheet', icon: 'circle-x', locations: [...locations], order: 30, visible: `record.status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'review_comment', objectOverride: 'forge_project_timesheet', required: true }],
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!record)throw new Error('工时记录不存在或不可访问');if(!actor)throw new Error('无法识别当前审核人');if(record.status!=='pending_review')throw new Error('仅待审核工时可以驳回');if(!ctx.input.review_comment||!String(ctx.input.review_comment).trim())throw new Error('驳回意见不能为空');await ctx.api.object('forge_project_timesheet').update({id,status:'rejected',reviewed_at:new Date().toISOString(),reviewer_id:actor,review_comment:String(ctx.input.review_comment).trim()});return{id,status:'rejected'};` },
});
