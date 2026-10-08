import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Runs inside the existing native HTTP/PostgreSQL harness, never a live tenant. */
export async function exerciseEmployeeBusinessCreation(h) {
  const {admin,organizationId,suffix,databaseClient:db,createEmployee,idOf,launcherSecret}=h;
  const create=async(object,data)=>idOf(await admin.request('/data/'+object,'POST',data),object);
  const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const category=await create('forge_customer_category',{name:'Creation references',code:'CR-'+suffix,status:'active'});
  const legacyCustomer=await create('forge_customer',{name:'Legacy context customer',category_id:category,responsible_id:admin.userId});
  const contractType=await create('forge_contract_type',{name:'Creation contract type',code:'CCT-'+suffix,status:'active'});
  const legacyContract=await create('forge_sales_contract',{name:'Legacy context contract',code:'LCC-'+suffix,customer_id:legacyCustomer,contract_type_id:contractType,responsible_id:admin.userId});
  const legacyContext=await admin.request('/workbench/business-actions/context?objectName=forge_sales_contract&recordId='+legacyContract);
  assert.equal(legacyContext.status,200,JSON.stringify(legacyContext.value));
  assert.equal((await scalar("SELECT is_nullable FROM information_schema.columns WHERE table_name='forge_employee_business_context' AND column_name='record_id'")).is_nullable,'YES','legacy required metadata did not imply physical NOT NULL');
  if(h.upgradeContextSchema) await h.upgradeContextSchema();
  assert.equal((await scalar('SELECT record_id FROM forge_employee_business_context WHERE id=$1',[legacyContext.value.contextId])).record_id,legacyContract,'the same database retains legacy record contexts after metadata upgrade');

  const sales=await createEmployee(admin,organizationId,'creation-sales');
  const unrelated=await createEmployee(admin,organizationId,'creation-unrelated');
  const grants=[];
  for(const permission of ['sales_lead_owner','sales_lead_conversion_operator','sales_quotation_draft_operator','sales_contract_operator','forge_sales_reference_reader']) {
    const ps=(await scalar('SELECT id FROM sys_permission_set WHERE name=$1',[permission])).id;
    grants.push({name:permission,id:idOf(await admin.request('/data/sys_user_permission_set','POST',{user_id:sales.userId,permission_set_id:ps,organization_id:organizationId,reason:'Isolated creation fixture'}),'permission grant')});
  }
  const context=async(object,references,who=sales)=>{
    const response=await who.request('/workbench/business-actions/context?'+new URLSearchParams({objectName:object,sourceKind:'creation',...(references?{referenceIds:JSON.stringify(references)}:{})}));
    assert.equal(response.status,200,JSON.stringify(response.value));
    const c=response.value;
    assert.equal(c.source.kind,'creation');assert.equal(c.objectName,object);
    assert.equal('record' in c,false);assert.equal('recordVersion' in c,false);
    assert.equal(c.actions.length,1);assert.equal(c.actions[0].requiresRecord,false);
    return c;
  };
  const input=(c,values,lineItems)=>({version:'1',contextId:c.contextId,contextVersion:c.contextVersion,opKey:randomUUID(),employeeMessage:{sessionId:randomUUID(),messageId:randomUUID(),sha256:'e'.repeat(64)},action_ref:c.actions[0].action_ref,values,...(lineItems?{lineItems}:{})});
  const execute=async(request,who=sales)=>{
    const r=await who.request('/workbench/business-actions/execute','POST',request);
    assert.equal(r.status,200,JSON.stringify(r.value));return r.value;
  };
  const succeeded=async(request)=>{const r=await execute(request);assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.recordReferences.length,1);return r;};
  const before=await scalar('SELECT count(*)::int AS count FROM forge_sales_lead');
  const leadContext=await context('forge_sales_lead');
  assert.equal((await scalar('SELECT record_id FROM forge_employee_business_context WHERE id=$1',[leadContext.contextId])).record_id,null);
  assert.equal((await unrelated.request('/workbench/business-actions/context?objectName=forge_sales_lead&sourceKind=creation')).status,403);
  assert.equal((await sales.request('/workbench/business-actions/context?objectName=forge_sales_lead&sourceKind=creation&recordId=forged')).status,400);
  const badOwner=await execute(input(leadContext,{name:'Rejected override',company_name:'Rejected',owner_id:admin.userId}));
  assert.equal(badOwner.status,'failed');assert.equal(badOwner.noEffect,true);
  const leadInput=input(leadContext,{name:'Equipment opportunity',company_name:'Creation customer',estimated_amount:2300,source:'Employee request'});
  const lead=await succeeded(leadInput),leadId=lead.recordReferences[0].recordId;
  const storedLead=await scalar('SELECT code,status,owner_id,responsible_id,organization_id,estimated_amount,contact_name,phone FROM forge_sales_lead WHERE id=$1',[leadId]);
  assert.equal(storedLead.status,'new');assert.equal(storedLead.owner_id,sales.userId);assert.equal(storedLead.responsible_id,sales.userId);assert.equal(storedLead.organization_id,organizationId);
  assert.equal(Number(storedLead.estimated_amount),2300);assert.equal(storedLead.contact_name,null);assert.equal(storedLead.phone,null);
  assert.match(storedLead.code,/^XS-\d{8}-\d{9}-\d{4}$/);assert.ok(lead.recordReferences[0].label.includes(storedLead.code));
  const repeat=await execute(leadInput);assert.equal(repeat.repeated,true);assert.deepEqual(repeat.recordReferences,lead.recordReferences);
  assert.equal((await scalar('SELECT count(*)::int AS count FROM forge_sales_lead')).count,before.count+1);
  assert.equal((await sales.request('/workbench/business-actions/execute','POST',{...leadInput,values:{...leadInput.values,name:'Changed'}})).status,409);
  const crossActor=await execute(leadInput,unrelated);assert.equal(crossActor.status,'failed');assert.equal(crossActor.noEffect,true);

  const customer=await create('forge_customer',{name:'Creation quote customer',category_id:category,responsible_id:sales.userId,owner_id:sales.userId});
  const otherCustomer=await create('forge_customer',{name:'Other employee customer',category_id:category,responsible_id:unrelated.userId,owner_id:unrelated.userId});
  const quoteType=await create('forge_quotation_type',{name:'Creation quote type',code:'CQT-'+suffix,status:'active'});
  const issuer=await create('forge_quotation_issuer',{name:'Creation issuer',credit_code:'CI-'+suffix});
  const materialCategory=await create('forge_material_category',{name:'Creation equipment',code:'CMC-'+suffix,status:'active'});
  const unit=await create('forge_unit',{name:'Creation set',code:'CU-'+suffix,status:'active'});
  const material=await create('forge_material',{name:'Creation equipment',code:'CM-'+suffix,model:'Equipment',category_id:materialCategory,unit_id:unit,status:'active'});
  const sku=await create('forge_material_sku',{name:'Standard equipment',code:'CS-'+suffix,material_id:material,sale_price:1800,cost_price:null,enabled:true});
  const references={customer_id:[customer],quotation_type_id:[quoteType],issuer_id:[issuer],sku_id:[sku]};
  const quoteContext=await context('forge_quotation',references);
  assert.ok(quoteContext.actions[0].lineItems.fields.find(p=>p.name==='sku_id').enum.includes(sku));
  assert.equal(quoteContext.actions[0].lineItems.fields.find(p=>p.name==='sku_id').enumLabels.find(p=>p.value===sku).label,'Creation equipment · Standard equipment（CS-'+suffix+'）','material provenance uses the complete employee-readable native label, without a model-supplied line name');
  assert.ok(!quoteContext.actions[0].parameters.some(p=>['code','lines_json'].includes(p.name)));
  const nameMask=(await scalar("SELECT id FROM sys_permission_set WHERE name='test_creation_material_name_mask'")).id;
  const nameMaskGrant=idOf(await admin.request('/data/sys_user_permission_set','POST',{user_id:sales.userId,permission_set_id:nameMask,organization_id:organizationId,reason:'Native field-read boundary'}),'name mask grant');
  const masked=await sales.request('/workbench/business-actions/context?'+new URLSearchParams({objectName:'forge_quotation',sourceKind:'creation',referenceIds:JSON.stringify(references)}));
  assert.equal(masked.status,403,'unreadable material names cannot become guessed or placeholder SKU labels');
  assert.ok((await admin.request('/data/sys_user_permission_set/'+nameMaskGrant,'DELETE')).status<300);
  assert.equal((await sales.request('/workbench/business-actions/context?'+new URLSearchParams({objectName:'forge_quotation',sourceKind:'creation',referenceIds:JSON.stringify({...references,customer_id:[otherCustomer]})}))).status,403,'native RLS rejects another employee customer');
  const header={name:'Employee two-line quote',customer_id:customer,quotation_type_id:quoteType,issuer_id:issuer,quotation_date:'2026-10-08',valid_until:'2027-10-08'};
  const lines=[{line_type:'material',sku_id:sku,quantity:1,taxed_unit_price:1800,tax_rate:13,discount_rate:0},{line_type:'service',name:'Installation and training',quantity:1,taxed_unit_price:500,tax_rate:13,discount_rate:0}];
  // The existing quote-only role does not grant opportunity read; its optional
  // source must not prevent a quote that does not select an opportunity.
  const quoteOnly=await createEmployee(admin,organizationId,'creation-quote-only');
  const quotePermission=(await scalar("SELECT id FROM sys_permission_set WHERE name='sales_quotation_draft_operator'")).id;
  await create('sys_user_permission_set',{user_id:quoteOnly.userId,permission_set_id:quotePermission,organization_id:organizationId,reason:'Existing quote-only native role'});
  const quoteOnlyCustomer=await create('forge_customer',{name:'Quote-only customer',category_id:category,responsible_id:quoteOnly.userId,owner_id:quoteOnly.userId});
  const unreadableOpportunity=await create('forge_sales_opportunity',{name:'Unreadable optional opportunity',customer_id:quoteOnlyCustomer,responsible_id:quoteOnly.userId,owner_id:quoteOnly.userId});
  assert.equal((await quoteOnly.request('/data/forge_sales_opportunity/'+unreadableOpportunity)).status,403,'quote-only native employee cannot read opportunities');
  const quoteOnlyReferences={...references,customer_id:[quoteOnlyCustomer]};
  const quoteOnlyContext=await context('forge_quotation',quoteOnlyReferences,quoteOnly);
  const optionalOpportunity=quoteOnlyContext.actions[0].parameters.find(p=>p.name==='opportunity_id');
  assert.equal(optionalOpportunity.required,false);assert.equal(optionalOpportunity.enum,undefined);assert.equal(optionalOpportunity.enumLabels,undefined);
  const quoteOnlyResult=await execute(input(quoteOnlyContext,{...header,name:'Quote without opportunity access',customer_id:quoteOnlyCustomer},lines),quoteOnly);
  assert.equal(quoteOnlyResult.status,'succeeded',JSON.stringify(quoteOnlyResult));
  const quoteOnlyRow=await scalar('SELECT owner_id,opportunity_id,item_count,total_amount FROM forge_quotation WHERE id=$1',[quoteOnlyResult.recordReferences[0].recordId]);
  assert.equal(quoteOnlyRow.owner_id,quoteOnly.userId);assert.equal(quoteOnlyRow.opportunity_id,null);assert.equal(Number(quoteOnlyRow.item_count),2);assert.equal(Number(quoteOnlyRow.total_amount),2300);
  assert.equal((await quoteOnly.request('/workbench/business-actions/context?'+new URLSearchParams({objectName:'forge_quotation',sourceKind:'creation',referenceIds:JSON.stringify({...quoteOnlyReferences,opportunity_id:[unreadableOpportunity]})}))).status,403,'explicit unreadable optional reference stays forbidden');
  for(const injected of [
    input(quoteContext,{...header,lines_json:'[]'},lines),
    input(quoteContext,{...header,valid_until:'2025-10-08'},lines),
    input(quoteContext,header,[lines[0],{...lines[1],sku_id:sku}]),
    input(quoteContext,header,[{...lines[0],cost_price:0},lines[1]]),
  ]) { const denied=await execute(injected);assert.equal(denied.status,'failed');assert.equal(denied.noEffect,true); }
  const quoteInput=input(quoteContext,header,lines);const quote=await succeeded(quoteInput);const quoteId=quote.recordReferences[0].recordId;
  const quoteRow=await scalar('SELECT code,status,item_count,total_amount,cost_total,owner_id FROM forge_quotation WHERE id=$1',[quoteId]);
  assert.equal(quoteRow.status,'draft');assert.equal(Number(quoteRow.item_count),2);assert.equal(Number(quoteRow.total_amount),2300);assert.equal(quoteRow.cost_total,null);assert.equal(quoteRow.owner_id,sales.userId);
  const quoteLines=(await db.query('SELECT line_type,sku_id,quantity,taxed_unit_price,cost_price FROM forge_quotation_line WHERE quotation_id=$1 ORDER BY sort_order',[quoteId])).rows;
  assert.equal(quoteLines.length,2);assert.equal(quoteLines[0].sku_id,sku);assert.equal(quoteLines[1].sku_id,null);assert.ok(quoteLines.every(row=>row.cost_price===null));
  assert.deepEqual((await execute(quoteInput)).recordReferences,quote.recordReferences);
  assert.equal((await db.query('SELECT id FROM forge_quotation_line WHERE quotation_id=$1',[quoteId])).rows.length,2);
  assert.equal((await sales.request('/workbench/business-actions/execute','POST',{...quoteInput,lineItems:[{...lines[0],taxed_unit_price:1600},lines[1]]})).status,409);

  await db.query(`INSERT INTO forge_customer (id,name,category_id,responsible_id,owner_id,organization_id) SELECT 'creation-many-'||$1||'-'||n,'Choice '||n,$2,$3,$3,$4 FROM generate_series(1,101) n`,[suffix,category,sales.userId,organizationId]);
  const broad=await sales.request('/workbench/business-actions/context?objectName=forge_quotation&sourceKind=creation');
  assert.equal(broad.status,409);assert.equal(broad.value.error.code,'EMPLOYEE_ACTION_REFERENCE_SELECTION_REQUIRED');
  const narrowed=await context('forge_quotation',references);assert.deepEqual(narrowed.actions[0].parameters.find(p=>p.name==='customer_id').enum,[customer]);
  const late=input(narrowed,{...header,name:'Permission revoked quote'},lines);
  const quoteGrant=grants.find(grant=>grant.name==='sales_quotation_draft_operator');
  assert.ok((await admin.request('/data/sys_user_permission_set/'+quoteGrant.id,'DELETE')).status<300);
  const revoked=await execute(late);assert.equal(revoked.status,'failed');assert.equal(revoked.noEffect,true);

  const draft=await create('forge_sales_contract',{name:'Payment terms draft',code:'CP-'+suffix,customer_id:customer,contract_type_id:contractType,responsible_id:sales.userId,owner_id:sales.userId,payment_term:'Initial terms'});
  const openDraft=async()=>{const r=await sales.request('/workbench/business-actions/context?objectName=forge_sales_contract&recordId='+draft);assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
  const draftContext=await openDraft();assert.ok(draftContext.recordVersion);assert.equal('objectName' in draftContext,false);
  const termAction=draftContext.actions.find(a=>a.capabilityId.endsWith('.contract_draft_payment_term_update'));assert.ok(termAction);
  const termInput={...input(draftContext,{payment_term:'30 percent before order'}),action_ref:termAction.action_ref};
  const terms=await succeeded(termInput);assert.equal(terms.recordReferences[0].recordId,draft);
  assert.equal((await scalar('SELECT payment_term FROM forge_sales_contract WHERE id=$1',[draft])).payment_term,'30 percent before order');
  assert.equal((await execute(termInput)).repeated,true);
  const stale=await execute({...termInput,opKey:randomUUID(),values:{payment_term:'Stale overwrite'}});assert.equal(stale.status,'failed');assert.equal(stale.noEffect,true);
  const next=await openDraft();const protectedInput={...input(next,{payment_term:'Ignored',total_amount:1}),action_ref:next.actions.find(a=>a.capabilityId.endsWith('.contract_draft_payment_term_update')).action_ref};
  assert.equal((await execute(protectedInput)).status,'failed');
  const priorApproval=randomUUID();
  await db.query("INSERT INTO sys_approval_request(id,object_name,record_id,submitter_id,status,organization_id) VALUES($1,'forge_sales_contract',$2,$3,'rejected',$4)",[priorApproval,draft,sales.userId,organizationId]);
  assert.ok(!(await openDraft()).actions.some(a=>a.capabilityId.endsWith('.contract_draft_payment_term_update')),'an existing native approval history cannot be reopened as a terms draft');
  await db.query('DELETE FROM sys_approval_request WHERE id=$1',[priorApproval]);
  await db.query("UPDATE forge_sales_contract SET status='active' WHERE id=$1",[draft]);
  assert.ok(!(await openDraft()).actions.some(a=>a.capabilityId.endsWith('.contract_draft_payment_term_update')));

  // The pre-existing record-bound route retains its original shape and execution.
  const oldRoute=await openDraft();
  const oldAction=oldRoute.actions.find(a=>a.capabilityId.endsWith('.contract_set_order_conditions'));assert.ok(oldAction);
  const oldRequest={...input(oldRoute,{order_payment_requirement:'none',order_prepayment_amount:0}),action_ref:oldAction.action_ref};
  await succeeded(oldRequest);
  assert.equal((await scalar('SELECT order_payment_requirement FROM forge_sales_contract WHERE id=$1',[draft])).order_payment_requirement,'none');

  const unknownContext=await context('forge_sales_lead');const unknownInput=input(unknownContext,{name:'Uncertain creation',company_name:'Uncertain company'});
  const beforeFault=await scalar('SELECT count(*)::int AS count FROM forge_sales_lead');
  assert.equal((await admin.request('/__test/receipt-fault','POST',{}, {Authorization:`Bearer ${launcherSecret}`})).status,200);
  const unknown=await execute(unknownInput);assert.equal(unknown.status,'unknown');
  assert.equal((await scalar('SELECT count(*)::int AS count FROM forge_sales_lead')).count,beforeFault.count,'receipt failure rolls the new lead back in the same native transaction');
  assert.equal((await execute(unknownInput)).status,'unknown');
  const blocked=await execute(input(await context('forge_sales_lead'),{name:'Do not replace original',company_name:'Uncertain company'}));
  assert.equal(blocked.status,'failed');assert.equal(blocked.code,'EMPLOYEE_ACTION_UNRESOLVED');
  assert.equal((await sales.request('/workbench/business-actions/operations/'+unknownInput.opKey)).value.status,'unknown');
  console.log('PASS native employee creation, owned references, old nullable context storage, header/lines, narrow terms, replay and atomic unknown-result fence');
}
