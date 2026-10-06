import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs inside the existing disposable 17.5 HTTP/NativePG harness. No live
// environment, credentials or business records are used by this fixture.
export async function exerciseOrderProjectHandoff(h) {
  const {admin,organizationId,suffix,databaseClient:db,createEmployee,idOf,executeEmployee,seedFile,mcpData,mcpText,stopRuntime,startRuntime,launcherSecret,secrets,port}=h;
  async function grant(client, name) {
    const id=(await db.query('SELECT id FROM sys_permission_set WHERE name=$1',[name])).rows[0]?.id; assert.ok(id,name);
    const result=await admin.request('/data/sys_user_permission_set','POST',{user_id:client.userId,permission_set_id:id,organization_id:organizationId,granted_by:admin.userId,reason:'隔离订单项目权限测试'});
    assert.ok(result.status<300,JSON.stringify(result.value));
  }
  async function position(client,name) {
    if(!(await db.query('SELECT id FROM sys_position WHERE organization_id=$1 AND name=$2',[organizationId,name])).rows.length)
      await db.query('INSERT INTO sys_position(id,name,label,active,organization_id) VALUES($1,$2,$3,true,$4)',[randomUUID(),name,name,organizationId]);
    await db.query('INSERT INTO sys_user_position(id,user_id,position,organization_id) VALUES($1,$2,$3,$4)',[randomUUID(),client.userId,name,organizationId]);
  }
  const sales=await createEmployee(admin,organizationId,'projectSales'), clerk=await createEmployee(admin,organizationId,'projectOrderClerk');
  const reviewer=await createEmployee(admin,organizationId,'projectOrderReviewer'), manager=await createEmployee(admin,organizationId,'projectManager');
  const otherManager=await createEmployee(admin,organizationId,'otherProjectManager'), otherSales=await createEmployee(admin,organizationId,'otherProjectSales');
  for(const name of ['sales_contract_operator','sales_quotation_draft_operator','forge_project_operator']) await grant(sales,name);
  for(const name of ['sales_contract_operator','sales_quotation_draft_operator','forge_project_operator']) await grant(otherSales,name);
  await grant(clerk,'sales_order_operator'); await position(clerk,'sales_order_operator');
  // The existing earlier fixtures do not create order-review positions.
  await grant(reviewer,'sales_order_reviewer'); await position(reviewer,'sales_order_reviewer');
  for(const client of [manager,otherManager]) {await grant(client,'forge_project_operator');await grant(client,'forge_project_manager');await position(client,'project_manager');}
  assert.equal(new Set([sales.userId,clerk.userId,reviewer.userId,manager.userId]).size,4);
  const category=idOf(await admin.request('/data/forge_customer_category','POST',{name:'TEST项目客户分类',code:'OPC-'+suffix,status:'active'}),'project category');
  const customer=idOf(await admin.request('/data/forge_customer','POST',{name:'TEST设备与安装培训客户',category_id:category,responsible_id:sales.userId,owner_id:sales.userId}),'project customer');
  const type=idOf(await admin.request('/data/forge_contract_type','POST',{name:'TEST项目合同类型',code:'OPT-'+suffix,status:'active'}),'project contract type');
  const contract=idOf(await admin.request('/data/forge_sales_contract','POST',{name:'TEST设备与安装培训合同',code:'OPC-'+suffix,contract_type_id:type,customer_id:customer,responsible_id:sales.userId,owner_id:sales.userId}),'project contract');
  const unit=idOf(await admin.request('/data/forge_unit','POST',{name:'TEST台',code:'OPU-'+suffix,status:'active'}),'project unit');
  const materialCategory=idOf(await admin.request('/data/forge_material_category','POST',{name:'TEST外购设备分类',code:'OPM-'+suffix,status:'active'}),'project material category');
  const material=idOf(await admin.request('/data/forge_material','POST',{name:'TEST外购设备',code:'OPM-'+suffix,model:'TEST设备',category_id:materialCategory,unit_id:unit,property:'traded',source_type:'purchased',status:'active'}),'project material');
  const sku=idOf(await admin.request('/data/forge_material_sku','POST',{name:'TEST设备标准规格',code:'OPS-'+suffix,material_id:material,enabled:true,sale_price:900}),'project SKU');
  for(const line of [{name:'TEST设备',line_type:'material',sku_id:sku,quantity_limit:2,taxed_unit_price:900,taxed_subtotal:1800,unit_name:'台'},
    {name:'TEST安装培训',line_type:'service',quantity_limit:1,taxed_unit_price:300,taxed_subtotal:300,unit_name:'项'}])
    idOf(await admin.request('/data/forge_sales_contract_line','POST',{contract_id:contract,organization_id:organizationId,owner_id:sales.userId,tax_rate:0,discount_rate:0,...line}),'project contract line');
  // Isolated already-reviewed contract fixture, followed by the real signature
  // action and real create/submit/independent native-order approval below.
  await db.query("UPDATE forge_sales_contract SET status='active', total_amount=2100,order_payment_requirement='none',order_prepayment_amount=0 WHERE id=$1",[contract]);
  const signer=await createEmployee(admin,organizationId,'projectSigner');await grant(signer,'contract_signature_registrar');await position(signer,'contract_signature_registrar');
  // Multiple signers are legal here because the actor is explicit and each
  // signature handler validates their own effective native appointment.
  const file=await seedFile(signer,'signed_evidence_attachment');
  await executeEmployee(signer,'forge_sales_contract',contract,'contract_register_signature',{signed_on:'2026-10-06',signed_evidence_note:'TEST合成材料登记，无真实签署'},file);
  const orderReceipt=await executeEmployee(clerk,'forge_sales_contract',contract,'contract_convert_to_sales_order',{code:'OPO-'+suffix,name:'TEST设备与安装培训订单',planned_delivery_on:'2026-10-25',payment_term:'TEST单独明确无需预付款',payment_method:'bank_transfer'});
  const order=orderReceipt.recordReferences.find(ref=>ref.objectName==='forge_sales_order').recordId;
  await executeEmployee(clerk,'forge_sales_order',order,'sales_order_submit',{});
  const request=(await db.query("SELECT id FROM sys_approval_request WHERE object_name='forge_sales_order' AND record_id=$1 AND status='pending'",[order])).rows[0];assert.ok(request);
  const review=await reviewer.request('/approvals/requests/'+request.id+'/workbench-context');assert.equal(review.status,200,JSON.stringify(review.value));
  const approve=review.value.availableActions.find(action=>action.semantic==='approve');assert.ok(approve);
  const result=await reviewer.callMcpTool('run_action',{actionName:approve.execution.actionName,objectName:'forge_sales_order',recordId:order,params:{...approve.execution.params,comment:'TEST独立核对设备两台和安装培训，金额2100'},confirm:true});
  assert.equal(mcpData(result)?.result?.decision,'approve',mcpText(result));
  assert.equal((await db.query('SELECT status FROM forge_sales_order WHERE id=$1',[order])).rows[0].status,'active');
  assert.equal((await sales.request('/data/forge_customer/'+customer)).status,200,'sales owns the customer through native RLS');
  assert.equal((await sales.request('/data/forge_sales_order/'+order)).status,200,'contract owner must have genuine native read of the clerk-owned order');
  for (const line of (await db.query('SELECT id FROM forge_sales_order_line WHERE order_id=$1',[order])).rows) {
    const read=await sales.request('/data/forge_sales_order_line/'+line.id);assert.equal(read.status,200,'contract owner must have native read of exact inherited order lines');
    assert.ok((await otherSales.request('/data/forge_sales_order_line/'+line.id)).status>=400,'same own admission does not grant another sales employee arbitrary order lines');
  }
  assert.ok((await otherSales.request('/data/forge_customer/'+customer)).status>=400);assert.ok((await otherSales.request('/data/forge_sales_contract/'+contract)).status>=400);
  const priceMasked=await sales.request('/data/forge_material_sku/'+sku);assert.equal(priceMasked.status,200);assert.ok(!/"cost_price"\s*:\s*(?:[-\d]|"\d)/.test(JSON.stringify(priceMasked.value)),'native source cost field remains denied');
  const foreignOrg=randomUUID(),foreignOrder=randomUUID(),foreignLine=randomUUID();
  await db.query("INSERT INTO forge_sales_order(id,name,code,customer_id,contract_id,responsible_id,owner_id,organization_id,planned_delivery_on,payment_term,payment_method,status,total_amount) VALUES($1,'TEST外组织订单',$2,$3,$4,$5,$5,$6,'2026-10-25','TEST','bank_transfer','active',2100)",[foreignOrder,'FOREIGN-'+suffix,customer,contract,clerk.userId,foreignOrg]);
  await db.query("INSERT INTO forge_sales_order_line(id,name,order_id,organization_id,line_type,quantity,taxed_unit_price,tax_rate,discount_rate,taxed_subtotal) VALUES($1,'TEST外组织服务',$2,$3,'service',1,300,0,0,300)",[foreignLine,foreignOrder,foreignOrg]);
  for(const client of [sales,clerk,manager]){assert.ok((await client.request('/data/forge_sales_order/'+foreignOrder)).status>=400);assert.ok((await client.request('/data/forge_sales_order_line/'+foreignLine)).status>=400,'native tenant wall rejects even a foreign order owner');}
  const projectType=idOf(await admin.request('/data/forge_project_type','POST',{name:'TEST外购设备与服务项目',code:'OPP-'+suffix,active:true}),'project type');
  const contextPath=(object,id)=>'/workbench/business-actions/context?objectName='+object+'&recordId='+id;
  const createContext=await sales.request(contextPath('forge_customer',customer));assert.equal(createContext.status,200,JSON.stringify(createContext.value));
  const action=createContext.value.actions.find(item=>item.capabilityId.endsWith('.customer_create_project'));assert.ok(action);
  for(const [name,id,label] of [['type_id',projectType,'TEST外购设备与服务项目'],['manager_id',manager.userId,'审批MCP隔离测试-projectManager'],['approved_order_id',order,'TEST设备与安装培训订单']])
    assert.equal(action.parameters.find(p=>p.name===name).enumLabels.find(option=>option.value===id)?.label,label);
  assert.equal(action.parameters.some(p=>/version|signature|confirm|receipt|source_order/.test(p.name)),false);
  const values={name:'TEST准确设备与服务交付项目',type_id:projectType,manager_id:manager.userId,priority:'medium',planned_start_on:'2026-10-07',planned_end_on:'2026-10-25',approved_order_id:order};
  function input(context,name,values={}) {return{version:'1',contextId:context.contextId,contextVersion:context.contextVersion,opKey:randomUUID(),employeeMessage:{sessionId:randomUUID(),messageId:randomUUID(),sha256:'f'.repeat(64)},action_ref:context.actions.find(a=>a.capabilityId.endsWith('.'+name)).action_ref,values};}
  const createInput=input(createContext.value,'customer_create_project',values),created=await sales.request('/workbench/business-actions/execute','POST',createInput);
  assert.equal(created.status,200);assert.equal(created.value.status,'succeeded',JSON.stringify(created.value));
  assert.equal(created.value.recordReferences.length,1);assert.equal(created.value.recordReferences[0].objectName,'forge_project');
  assert.equal(created.value.recordReferences[0].label,values.name);
  const project=created.value.recordReferences[0].recordId;
  const original=(await db.query('SELECT status,source_order_id,manager_id,expected_revenue,budget_amount,total_cost FROM forge_project WHERE id=$1',[project])).rows[0];
  assert.deepEqual(original,{status:'pending',source_order_id:order,manager_id:manager.userId,expected_revenue:null,budget_amount:null,total_cost:null});
  const repeat=await sales.request('/workbench/business-actions/execute','POST',createInput);assert.equal(repeat.value.repeated,true);assert.deepEqual(repeat.value.recordReferences,created.value.recordReferences);
  assert.equal((await sales.request('/workbench/business-actions/execute','POST',{...createInput,values:{...values,name:'不同内容'}})).status,409);
  assert.ok((await otherManager.request(contextPath('forge_project',project))).status>=400,'unassigned manager cannot open this project');
  const beforeLink=await manager.request(contextPath('forge_project',project));assert.equal(beforeLink.status,200);assert.equal(beforeLink.value.actions.some(a=>a.capabilityId.endsWith('.project_start')),false);
  const linkContext=await sales.request(contextPath('forge_project',project));assert.equal(linkContext.status,200,JSON.stringify(linkContext.value));
  const link=linkContext.value.actions.find(a=>a.capabilityId.endsWith('.project_link_contract'));assert.ok(link);
  assert.equal(link.parameters.find(p=>p.name==='contract_id').enumLabels[0].value,contract);assert.deepEqual(link.parameters.find(p=>p.name==='approved_order_id').enum,[order]);
  const linkInput=input(linkContext.value,'project_link_contract',{contract_id:contract,approved_order_id:order});
  const linked=await sales.request('/workbench/business-actions/execute','POST',linkInput);assert.equal(linked.value.status,'succeeded',JSON.stringify(linked.value));
  assert.equal((await db.query('SELECT id FROM forge_project_sales_link WHERE project_id=$1',[project])).rows.length,1);
  const shares=(await db.query("SELECT object_name,record_id,recipient_id,access_level,source_id FROM sys_record_share WHERE source='team' AND source_id LIKE 'forge-project-delivery:%' AND recipient_id=$1",[manager.userId])).rows;
  assert.ok(shares.some(share=>share.object_name==='forge_sales_order'&&share.record_id===order&&share.access_level==='read'));
  assert.ok(shares.some(share=>share.object_name==='forge_customer'&&share.record_id===customer));
  assert.equal((await manager.request('/data/forge_sales_order/'+order)).status,200,'native Sharing admits the exact clerk-owned order');
  assert.ok((await otherManager.request('/data/forge_sales_order/'+order)).status>=400,'the same role cannot read unlinked sales sources');
  const scope=await manager.callMcpTool('run_action',{actionName:'project_read_delivery_scope',objectName:'forge_project',recordId:project,params:{}});
  assert.equal(scope.isError,undefined,mcpText(scope));const projected=mcpData(scope)?.result;assert.ok(projected,mcpText(scope));
  assert.deepEqual(projected.lines.toSorted((a,b)=>a.line_type.localeCompare(b.line_type)).map(line=>[line.line_type,line.name,line.quantity,line.taxed_unit_price,line.taxed_subtotal,line.trace_consistent]),[['material','TEST设备',2,900,1800,true],['service','TEST安装培训',1,300,300,true]]);
  assert.equal(projected._server_binding,undefined,'internal refs and source digest never enter the public native read result');
  assert.ok(projected.lines.every(line=>!('sku_id'in line)&&!('cost_price'in line)));
  async function assertScopeClosed(label){
    const read=await manager.callMcpTool('run_action',{actionName:'project_read_delivery_scope',objectName:'forge_project',recordId:project,params:{}});
    assert.equal(read.isError,true,label+' native public scope is closed');assert.ok(!mcpData(read)?.result?.lines);
    const current=await manager.request(contextPath('forge_project',project));assert.equal(current.status,200,JSON.stringify(current.value));assert.equal(current.value.actions.some(action=>action.capabilityId.endsWith('.project_start')),false,label+' is not ready');
    const gui=await manager.request('/actions/forge_project/project_start/'+project,'POST',{params:{},confirm:true});assert.ok(gui.status>=400,label+' native GUI start is refused');assert.ok(/PROJECT_SCOPE_|项目/.test(JSON.stringify(gui.value)),JSON.stringify(gui.value));
    const stored=(await db.query('SELECT status,actual_start_on FROM forge_project WHERE id=$1',[project])).rows[0];assert.deepEqual(stored,{status:'pending',actual_start_on:null},label+' cannot commit or stamp startup');
  }
  for(const object of ['forge_sales_order','forge_sales_contract','forge_sales_order_line','forge_sales_contract_line'])for(const answer of ['undefined','null','throw']){
    assert.equal((await admin.request('/__test/project-field-fault','POST',{object,answer},{Authorization:'Bearer '+launcherSecret})).status,200);await assertScopeClosed(object+' '+answer);
    assert.equal((await admin.request('/__test/project-field-fault','POST',{}, {Authorization:'Bearer '+launcherSecret})).status,200);
  }
  for(const name of ['test_project_price_mask','test_project_header_mask']){
    await grant(manager,name);await assertScopeClosed(name);
    await db.query('DELETE FROM sys_user_permission_set WHERE user_id=$1 AND permission_set_id=(SELECT id FROM sys_permission_set WHERE name=$2)',[manager.userId,name]);
  }
  for(const fault of [{object:'forge_sales_order',omit:'code'},{object:'forge_sales_order_line',omit:'quantity'},{object:'forge_sales_order_line',omit:'taxed_subtotal'},{object:'forge_sales_contract_line',omit:'quantity_limit'}]){
    assert.equal((await admin.request('/__test/project-field-fault','POST',fault,{Authorization:'Bearer '+launcherSecret})).status,200);await assertScopeClosed(fault.object+' missing '+fault.omit);
    assert.equal((await admin.request('/__test/project-field-fault','POST',{}, {Authorization:'Bearer '+launcherSecret})).status,200);
  }
  const ready=await manager.request(contextPath('forge_project',project));assert.equal(ready.status,200,JSON.stringify(ready.value));assert.ok(ready.value.actions.find(a=>a.capabilityId.endsWith('.project_start')));
  const oldStart=input(ready.value,'project_start');
  const member=idOf(await sales.request('/data/forge_project_member','POST',{name:'TEST项目成员',project_id:project,user_id:otherManager.userId,member_duty:'member',active:true}),'project member');
  const stale=await manager.request('/workbench/business-actions/execute','POST',oldStart);assert.equal(stale.value.status,'failed');assert.equal(stale.value.noEffect,true);
  assert.equal((await otherManager.request('/data/forge_sales_order/'+order)).status,200,'an active native project member inherits exact source read');
  async function transferManager(target, failure=false) {const version=(await db.query('SELECT updated_at FROM forge_project WHERE id=$1',[project])).rows[0].updated_at;const result=await sales.request('/actions/forge_project/project_manager_transfer/'+project,'POST',{params:{manager_id:target,updated_at:version.toISOString()}});if(failure){assert.equal(result.status,400,JSON.stringify(result.value));return;}if(result.status>=300){const shape=await admin.request('/__test/member-shape','POST',{}, {Authorization:'Bearer '+launcherSecret});assert.fail(JSON.stringify({result:result.value,shape:shape.value}));}}
  for(const mode of ['actor','future','old']) {assert.equal((await admin.request('/__test/member-audit-fault','POST',{mode},{Authorization:'Bearer '+launcherSecret})).status,200);await transferManager(otherManager.userId,true);assert.equal((await db.query('SELECT manager_id FROM forge_project WHERE id=$1',[project])).rows[0].manager_id,manager.userId,'audit spoof rolls back exact manager and native shares');}
  const independentShare=await admin.request('/__test/native-share','POST',{actorId:admin.userId,organizationId,grant:{object:'forge_sales_contract',recordId:contract,recipientId:otherManager.userId,recipientType:'user',accessLevel:'read',source:'manual',sourceId:'independent-fixture'}},{Authorization:'Bearer '+launcherSecret});assert.equal(independentShare.status,200);
  await transferManager(otherManager.userId);
  assert.ok((await manager.request('/data/forge_sales_order/'+order)).status>=400,'native manager transfer revokes former manager source provenance');
  assert.equal((await otherManager.request('/data/forge_sales_order/'+order)).status,200);
  await transferManager(manager.userId);
  assert.ok((await otherManager.request('/data/forge_sales_order/'+order)).status>=400,'native transfer deactivates old member and revokes only its project source');
  assert.equal((await db.query('SELECT id FROM sys_record_share WHERE id=$1',[independentShare.value.id])).rows.length,1,'other native manual provenance survives manager and member deactivation');
  assert.equal((await otherManager.request('/data/forge_sales_contract/'+contract)).status,200,'independent native manual read remains usable');
  const linkedId=(await db.query('SELECT id FROM forge_project_sales_link WHERE project_id=$1',[project])).rows[0].id;
  const detached=await admin.request('/__test/remove-project-link','POST',{linkId:linkedId,organizationId,actorId:sales.userId},{Authorization:'Bearer '+launcherSecret});assert.equal(detached.status,200,JSON.stringify(detached.value));
  assert.ok((await manager.request('/data/forge_sales_order/'+order)).status>=400,'the real native afterDelete link hook revokes the exact project source');
  assert.equal((await manager.request(contextPath('forge_project',project))).value.actions.some(action=>action.capabilityId.endsWith('.project_start')),false);
  assert.equal((await db.query('SELECT id FROM sys_record_share WHERE id=$1',[independentShare.value.id])).rows.length,1);
  await executeEmployee(sales,'forge_project',project,'project_link_contract',{contract_id:contract,approved_order_id:order});
  async function projectWork() {let cursor,found;for(let page=0;page<10;page++){const work=await manager.request('/workbench/business-work?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(work.status,200,JSON.stringify(work.value));found ||= work.value.items.find(item=>item.kind==='project_start'&&item.record.recordId===project);cursor=work.value.nextCursor;if(!cursor)break;}assert.ok(found,'current manager has a durable native-derived project_start item');return found;}
  const pendingWork=await projectWork();
  await stopRuntime();await startRuntime();
  const restoredWork=await projectWork();assert.equal(restoredWork.recordVersion,pendingWork.recordVersion,'same database restart preserves the frozen work version');
  const startContext=await manager.request(contextPath('forge_project',project)),startInput=input(startContext.value,'project_start');
  const start=await manager.request('/workbench/business-actions/execute','POST',startInput);
  if(start.value.status!=='succeeded'){const diagnostic=await admin.request('/__test/native-failure','POST',{}, {Authorization:'Bearer '+launcherSecret});assert.fail(JSON.stringify({result:start.value,diagnostic:diagnostic.value}));}
  const success=start.value;
  assert.equal((await db.query('SELECT status FROM forge_project WHERE id=$1',[project])).rows[0].status,'in_progress');
  assert.deepEqual(success.recordReferences,[{objectName:'forge_project',recordId:project,label:values.name}]);
  assert.deepEqual((await manager.request('/workbench/business-actions/operations/'+success.operationId)).value.recordReferences,success.recordReferences);
  assert.equal((await manager.request('/data/forge_sales_order/'+order)).status,200,'same NativePG source sharing survives full stop/restart');
  assert.equal((await manager.request(contextPath('forge_project',project))).value.actions.some(a=>a.capabilityId.endsWith('.project_start')),false);
  // Explicit zero is retained as stated input; this independent project also
  // holds the concurrency/unknown fixture without retrying the successful one.
  const zero=await executeEmployee(sales,'forge_customer',customer,'customer_create_project',{...values,name:'TEST独立并发项目',expected_revenue:0,budget_amount:0});
  const raceProject=zero.recordReferences[0].recordId;
  const zeroRow=(await db.query('SELECT expected_revenue,budget_amount,total_cost FROM forge_project WHERE id=$1',[raceProject])).rows[0];
  assert.equal(Number(zeroRow.expected_revenue),0);assert.equal(Number(zeroRow.budget_amount),0);assert.equal(zeroRow.total_cost,null);
  await executeEmployee(sales,'forge_project',raceProject,'project_link_contract',{contract_id:contract,approved_order_id:order});
  const parallelContext=(await manager.request(contextPath('forge_project',raceProject))).value;
  const a=input(parallelContext,'project_start'),b={...a,opKey:randomUUID(),employeeMessage:{...a.employeeMessage,messageId:randomUUID()}};
  assert.equal((await admin.request('/__test/start-race','POST',{recordId:raceProject,a:a.opKey,b:b.opKey},{Authorization:'Bearer '+launcherSecret})).status,200);
  const first=manager.request('/workbench/business-actions/execute','POST',a);
  const second=manager.request('/workbench/business-actions/execute','POST',b);
  const results=await Promise.all([first,second]);
  const state=await admin.request('/__test/start-race-state','POST',{}, {Authorization:'Bearer '+launcherSecret});
  assert.equal(state.value.attempts,1,JSON.stringify(state.value));assert.equal(state.value.entered,true);assert.equal(state.value.bReserved,true,'B is reserved while A is dispatched and holds the same record lock');
  const final=(await db.query('SELECT status,actual_start_on FROM forge_project WHERE id=$1',[raceProject])).rows[0];
  if(results[0].value.status==='unknown') {
    assert.equal(final.status,'pending');assert.equal(final.actual_start_on,null);
    assert.equal((await manager.request('/workbench/business-actions/execute','POST',a)).value.status,'unknown');
    const blocked=await manager.request('/workbench/business-actions/execute','POST',{...a,opKey:randomUUID()});assert.equal(blocked.value.status,'failed');assert.equal(blocked.value.noEffect,true);assert.equal(blocked.value.code,'EMPLOYEE_ACTION_UNRESOLVED');
    assert.equal((await manager.request('/workbench/business-actions/operations/'+a.opKey)).value.status,'unknown');
    assert.fail(JSON.stringify({diagnostic:state.value,results:results.map(reply=>({status:reply.value.status,code:reply.value.code,noEffect:reply.value.noEffect})),committed:false}));
  }
  assert.equal(results[0].value.status,'succeeded',JSON.stringify(results));assert.equal(results[1].value.status,'failed');assert.equal(results[1].value.noEffect,true);assert.equal(final.status,'in_progress');

  const taskScope={input_revision_id:randomUUID(),registration_id:randomUUID(),task_sha256:'d'.repeat(64),workflow_id:'test-order-project-read',workflow_version:1,allowed_actions:['forge:action:forge_project.project_read_delivery_scope'],resources:[],business_record:{object_name:'forge_project',record_id:raceProject}};
  const writes=[['forge_customer','customer_create_project'],['forge_project','project_link_contract'],['forge_project','project_start']];
  const catalog=await sales.request('/workbench/business-actions/catalog'), managerCatalog=await manager.request('/workbench/business-actions/catalog');
  for(const [object,name] of writes){assert.equal((name==='project_start'?managerCatalog:catalog).value.capabilities.find(cap=>cap.objectName===object&&cap.actionName===name)?.executionMode,'employee_only');const refused=await sales.request('/apps/forge/task-delegations','POST',{request_id:randomUUID(),scope:{...taskScope,allowed_actions:['forge:action:'+object+'.'+name]}});assert.equal(refused.status,403);}
  assert.equal(catalog.value.capabilities.find(cap=>cap.actionName==='project_read_delivery_scope')?.effect,'read');
  const delegation=await sales.request('/apps/forge/task-delegations','POST',{request_id:randomUUID(),scope:taskScope});assert.equal(delegation.status,200);const token=delegation.value.access_token;assert.ok(token);secrets.push(token);
  async function taskRpc(method,params,id=1){const response=await fetch('http://127.0.0.1:'+port+'/api/v1/apps/forge/task-delegations/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'http://127.0.0.1:'+port,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});const text=await response.text(),lines=text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);return{status:response.status,value:JSON.parse(lines.at(-1)||text)};}
  assert.equal((await taskRpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'project-task-refusal',version:'1'}})).status,200);
  const taskList=await taskRpc('tools/call',{name:'list_actions',arguments:{}},2);assert.equal(taskList.status,200);assert.notEqual(taskList.value?.result?.isError,true);assert.equal(taskList.value?.error,undefined);const listed=JSON.stringify(taskList.value);for(const[,name]of writes)assert.ok(!listed.includes(name));
  const taskMetadata=await sales.request('/apps/forge/task-delegations/objects/forge_project','GET',undefined,{Cookie:'',Authorization:'Bearer '+token});assert.equal(taskMetadata.status,200);assert.equal(taskMetadata.value?.error,undefined);assert.ok(taskMetadata.value.item?.actions.some(action=>action.name==='project_read_delivery_scope'));const metadata=JSON.stringify(taskMetadata.value);for(const[,name]of writes)assert.ok(!metadata.includes(name));
  for(const [object,name]of writes){const denied=await taskRpc('tools/call',{name:'run_action',arguments:{actionName:name,objectName:object,recordId:raceProject,params:{}}},4);assert.ok(denied.value?.result?.isError===true||denied.value?.error,'task runtime cannot execute '+name);}
  assert.ok((await sales.request(contextPath('forge_project',raceProject),'GET',undefined,{Cookie:'',Authorization:'Bearer '+token})).status>=400,'task credential never opens the employee-only connection');

  // A source collision rolls back the entire link and cannot overwrite a
  // native review team's provenance; the uncertain operation is lookup-only.
  const collision=await executeEmployee(sales,'forge_customer',customer,'customer_create_project',{...values,name:'TEST分享来源冲突项目',manager_id:otherManager.userId});
  const collisionProject=collision.recordReferences[0].recordId;
  const reviewShare=await admin.request('/__test/native-share','POST',{actorId:admin.userId,organizationId,grant:{object:'forge_sales_contract',recordId:contract,recipientId:otherManager.userId,recipientType:'user',accessLevel:'read',source:'team',sourceId:'independent-review-fixture'}},{Authorization:'Bearer '+launcherSecret});assert.equal(reviewShare.status,200);
  const collisionCtx=(await sales.request(contextPath('forge_project',collisionProject))).value, collisionInput=input(collisionCtx,'project_link_contract',{contract_id:contract,approved_order_id:order});
  const conflict=await sales.request('/workbench/business-actions/execute','POST',collisionInput);assert.equal(conflict.value.status,'unknown');
  assert.equal((await db.query('SELECT id FROM forge_project_sales_link WHERE project_id=$1',[collisionProject])).rows.length,0,'source collision leaves no half link');
  assert.equal((await db.query('SELECT source_id FROM sys_record_share WHERE id=$1',[reviewShare.value.id])).rows[0].source_id,'independent-review-fixture');
  assert.equal((await sales.request('/workbench/business-actions/execute','POST',collisionInput)).value.status,'unknown');
  const collisionBlocked=await sales.request('/workbench/business-actions/execute','POST',{...collisionInput,opKey:randomUUID()});assert.equal(collisionBlocked.value.status,'failed');assert.equal(collisionBlocked.value.noEffect,true);assert.equal(collisionBlocked.value.code,'EMPLOYEE_ACTION_UNRESOLVED');
  const createCtx=(await sales.request(contextPath('forge_customer',customer))).value, failedCreate=input(createCtx,'customer_create_project',{...values,name:'TEST未知立项回滚'});
  const countBefore=Number((await db.query('SELECT count(*) AS n FROM forge_project WHERE customer_id=$1',[customer])).rows[0].n);
  assert.equal((await admin.request('/__test/receipt-fault','POST',{}, {Authorization:'Bearer '+launcherSecret})).status,200);
  const uncertain=await sales.request('/workbench/business-actions/execute','POST',failedCreate);assert.equal(uncertain.value.status,'unknown');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM forge_project WHERE customer_id=$1',[customer])).rows[0].n),countBefore,'receipt failure atomically rolls back project and manager member');
  assert.equal((await sales.request('/workbench/business-actions/execute','POST',failedCreate)).value.status,'unknown');
  const unknownBlocked=await sales.request('/workbench/business-actions/execute','POST',{...failedCreate,opKey:randomUUID()});assert.equal(unknownBlocked.value.status,'failed');assert.equal(unknownBlocked.value.noEffect,true);assert.equal(unknownBlocked.value.code,'EMPLOYEE_ACTION_UNRESOLVED');
  await stopRuntime();await startRuntime();
  assert.equal((await sales.request('/workbench/business-actions/operations/'+failedCreate.opKey)).value.status,'unknown');
  assert.equal((await sales.request('/workbench/business-actions/operations/'+collisionInput.opKey)).value.status,'unknown');
  assert.deepEqual((await manager.request('/workbench/business-actions/operations/'+success.operationId)).value.recordReferences,success.recordReferences);

}
