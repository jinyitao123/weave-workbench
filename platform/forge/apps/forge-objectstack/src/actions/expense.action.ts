import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

const projectExpenseContext = `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前操作人和组织');
async function projectInOrganization(projectId){const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId}});if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');if(['settled','terminated','archived'].includes(project.status))throw new Error('已结算、已终止或已归档项目不可办理费用');return project;}
async function activeProjectMember(projectId,userId){const member=await ctx.api.object('forge_project_member').findOne({where:{project_id:projectId,organization_id:organizationId,user_id:userId,active:true}});return member&&member.active===true?member:null;}

`;

export const ProjectCreateExpense = defineAction({
  name: 'project_create_expense', label: '新建项目费用', objectName: 'forge_project', icon: 'hand-coins', locations: [...locations], order: 110,
  requiredPermissions: ['forge_project_work_member'],
  visible: `record.status != 'settled' && record.status != 'terminated' && record.status != 'archived'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_project_expense', required: true }, { field: 'name', objectOverride: 'forge_project_expense', required: true },
    { field: 'claim_type', objectOverride: 'forge_project_expense', required: true, defaultValue: 'self' },
    { field: 'beneficiary_id', objectOverride: 'forge_project_expense', required: true }, { field: 'supplier_id', objectOverride: 'forge_project_expense' },
    { field: 'expected_payment_on', objectOverride: 'forge_project_expense' },
    { field: 'category', objectOverride: 'forge_project_expense_line', required: true }, { field: 'occurred_on', objectOverride: 'forge_project_expense_line', required: true },
    { field: 'amount', objectOverride: 'forge_project_expense_line', required: true }, { field: 'description', objectOverride: 'forge_project_expense_line', required: true },
    { field: 'invoice_reference', objectOverride: 'forge_project_expense_line' }, { field: 'remarks', objectOverride: 'forge_project_expense' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/page_project_expense_cost?expense=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectExpenseContext}
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),initial=ctx.record;
if(ctx.recordLoadDenied===true||!projectId||!initial)throw new Error('当前项目不存在或不可访问');
const title=String(ctx.input.name||'').trim(),description=String(ctx.input.description||'').trim(),amount=Number(ctx.input.amount||0),category=String(ctx.input.category||'');
const costType={manufacturing:'manufacturing',travel:'travel',subcontract:'subcontract',inspection:'other',software:'other',office:'other',other:'other'}[category];
if(!String(ctx.input.code||'').trim()||!title||!description)throw new Error('费用单号、标题和费用说明不能为空');
if(!(amount>0))throw new Error('费用金额必须大于0');if(!costType)throw new Error('费用类别无效');
const claimType=String(ctx.input.claim_type||'self'),requestedBeneficiary=String(ctx.input.beneficiary_id||'').trim();
if(!['self','on_behalf'].includes(claimType))throw new Error('报销类型无效');
return await ctx.api.transaction(async()=>{
 const project=await projectInOrganization(projectId);
 if(!await activeProjectMember(projectId,actor))throw new Error('仅当前项目有效成员可以发起本人报销');
 let beneficiary=actor;
 if(claimType==='on_behalf'){
  if(actor!==String(project.manager_id||''))throw new Error('仅当前项目经理可以代他人报销');
  const manager=await activeProjectMember(projectId,actor);if(!manager||manager.member_duty!=='manager')throw new Error('仅当前项目经理可以代他人报销');
  if(!requestedBeneficiary||!await activeProjectMember(projectId,requestedBeneficiary))throw new Error('代报销人必须是当前项目有效成员');
  beneficiary=requestedBeneficiary;
 }
 const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000;
 const created=await ctx.api.object('forge_project_expense').insert({name:title,code:String(ctx.input.code).trim(),project_id:projectId,customer_id:project.customer_id,ownership_type:'project',claim_type:claimType,applicant_id:actor,beneficiary_id:beneficiary,supplier_id:ctx.input.supplier_id||null,expected_payment_on:ctx.input.expected_payment_on||null,total_amount:round4(amount),line_count:1,status:'draft',approval_status:null,submitted_at:null,reviewed_at:null,reviewer_id:null,review_comment:null,cost_entry_count:0,owner_id:actor,responsible_id:project.manager_id,remarks:ctx.input.remarks||null});
 const expenseId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!expenseId)throw new Error('项目费用创建后未返回记录ID');
 const lineCreated=await ctx.api.object('forge_project_expense_line').insert({name:description,line_key:expenseId+':001',expense_id:expenseId,organization_id:organizationId,category,cost_type:costType,occurred_on:ctx.input.occurred_on,amount:round4(amount),description,invoice_reference:ctx.input.invoice_reference||null,attachment:null,remarks:null});
 const lineId=typeof lineCreated==='string'?lineCreated:lineCreated&&(lineCreated.id||(lineCreated.record&&lineCreated.record.id));if(!lineId)throw new Error('费用明细创建后未返回记录ID');
 return{id:expenseId,line_id:lineId,status:'draft',line_count:1,total_amount:round4(amount)};
});
` },
});

export const ProjectExpenseAddLine = defineAction({
  name: 'project_expense_add_line', label: '添加费用项', objectName: 'forge_project_expense', icon: 'list-plus', locations: [...locations], order: 10,
  requiredPermissions: ['forge_project_work_member'], visible: `record.status == 'draft'`, refreshAfter: true,
  params: [
    { field: 'category', objectOverride: 'forge_project_expense_line', required: true }, { field: 'occurred_on', objectOverride: 'forge_project_expense_line', required: true },
    { field: 'amount', objectOverride: 'forge_project_expense_line', required: true }, { field: 'description', objectOverride: 'forge_project_expense_line', required: true },
    { field: 'invoice_reference', objectOverride: 'forge_project_expense_line' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectExpenseContext}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),initial=ctx.record;
if(ctx.recordLoadDenied===true||!id||!initial)throw new Error('项目费用不存在或不可访问');
const description=String(ctx.input.description||'').trim(),amount=Number(ctx.input.amount||0),category=String(ctx.input.category||'');
const costType={manufacturing:'manufacturing',travel:'travel',subcontract:'subcontract',inspection:'other',software:'other',office:'other',other:'other'}[category];
if(!description)throw new Error('费用说明不能为空');if(!(amount>0))throw new Error('费用金额必须大于0');if(!costType)throw new Error('费用类别无效');
const expectedUpdatedAt=String(initial.updated_at||''),expectedTime=Date.parse(expectedUpdatedAt);if(!Number.isFinite(expectedTime))throw new Error('费用读取版本无效');
return await ctx.api.transaction(async()=>{
const expenses=ctx.api.object('forge_project_expense'),expense=await expenses.findOne({where:{id,organization_id:organizationId}});
 if(!expense||expense.status!=='draft'||String(expense.updated_at||'')!==expectedUpdatedAt)throw new Error('费用已被修改或不再是草稿，请刷新后重试');
 if(expense.applicant_id!==actor)throw new Error('仅费用申请人可以修改本人费用草稿');
 const project=await projectInOrganization(String(expense.project_id||''));
 const lines=await ctx.api.object('forge_project_expense_line').find({where:{expense_id:id,organization_id:organizationId}}),index=lines.length+1;
 const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000,total=round4(lines.reduce((sum,x)=>sum+Number(x.amount||0),0)+amount);
 const created=await ctx.api.object('forge_project_expense_line').insert({name:description,line_key:id+':'+String(index).padStart(3,'0'),expense_id:id,category,cost_type:costType,occurred_on:ctx.input.occurred_on,amount:round4(amount),description,invoice_reference:ctx.input.invoice_reference||null,attachment:null,remarks:null,organization_id:organizationId});
 const lineId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!lineId)throw new Error('费用明细创建后未返回记录ID');
 const changed=await expenses.update({total_amount:total,line_count:index},{multi:true,where:{id,organization_id:organizationId,applicant_id:actor,status:'draft',updated_at:{$gte:new Date(expectedTime).toISOString(),$lt:new Date(expectedTime+1).toISOString()}}});
 if(changed!==1)throw new Error('费用已被修改，请刷新后重试');
 return{id,line_id:lineId,status:'draft',line_count:index,total_amount:total,project_id:project.id};
});
` },
});

export const ProjectExpenseSubmit = defineAction({
  name: 'project_expense_submit', label: '提交审批', objectName: 'forge_project_expense', icon: 'send', locations: [...locations], order: 20,
  requiredPermissions: ['forge_project_work_member'], visible: `record.status == 'draft'`, refreshAfter: true,
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `${projectExpenseContext}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),initial=ctx.record;
if(ctx.recordLoadDenied===true||!id||!initial)throw new Error('项目费用不存在或不可访问');
const expectedUpdatedAt=String(initial.updated_at||''),expectedTime=Date.parse(expectedUpdatedAt);if(!Number.isFinite(expectedTime))throw new Error('费用读取版本无效');
 const expenses=ctx.api.object('forge_project_expense'),expense=await expenses.findOne({where:{id,organization_id:organizationId}});
 if(!expense||expense.status!=='draft'||String(expense.updated_at||'')!==expectedUpdatedAt)throw new Error('仅未修改的费用草稿可以提交');
 if(expense.applicant_id!==actor)throw new Error('仅费用申请人可以提交本人费用');
 const project=await projectInOrganization(String(expense.project_id||''));if(!project.manager_id)throw new Error('项目当前没有负责人，不能发起原生审批');
 const manager=await activeProjectMember(project.id,String(project.manager_id));if(!manager||manager.member_duty!=='manager')throw new Error('项目负责人不是当前有效团队成员，不能发起原生审批');
 const lines=await ctx.api.object('forge_project_expense_line').find({where:{expense_id:id,organization_id:organizationId}});
 if(!lines.length||lines.some(x=>!(Number(x.amount)>0)))throw new Error('费用明细不能为空且金额必须大于0');
 const total=Math.round((lines.reduce((sum,x)=>sum+Number(x.amount||0),0)+Number.EPSILON)*10000)/10000,now=new Date().toISOString();
const changed=await expenses.update({total_amount:total,line_count:lines.length,status:'pending_review',approval_status:null,responsible_id:project.manager_id,submitted_at:now},{multi:true,where:{id,organization_id:organizationId,applicant_id:actor,status:'draft',updated_at:{$gte:new Date(expectedTime).toISOString(),$lt:new Date(expectedTime+1).toISOString()}}});
if(changed!==1)throw new Error('费用已被修改，请刷新后重试');
return{id,status:'pending_review',total_amount:total,responsible_id:project.manager_id};
` },
});
