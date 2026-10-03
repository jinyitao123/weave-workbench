import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { LiteKernel } from '@objectstack/core';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { ApprovalsServicePlugin, SysApprovalAction, SysApprovalApprover, SysApprovalRequest, SysApprovalDelegation } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { SalesContract, SalesContractLine, SalesOrder, SalesOrderLine } from '../src/objects/sales.object.ts';
import { CustomerPrepayment } from '../src/objects/finance.object.ts';
import { SalesOrderBusinessPlugin } from '../src/plugins/sales-order-business.plugin.ts';
import { SalesOrderApprovalFlow } from '../src/flows/sales-order-approval.flow.ts';
import { SIGNATURE_TARGET, ORDER_CONDITIONS_TARGET, CONTRACT_ORDER_TARGET, ORDER_SUBMIT_TARGET, CONTRACT_PREPAYMENT_TARGET, PREPAYMENT_CONFIRM_TARGET, ORDER_APPLY_APPROVAL_TARGET } from '../src/plugins/sales-order-domain.ts';

const { SystemFile, installFileReferenceHooks } = await import('../node_modules/.pnpm/@objectstack+service-storage@17.3.0/node_modules/@objectstack/service-storage/dist/index.js');
const sys = { isSystem: true, positions: [], permissions: [] };
const simple = (name, fields) => ObjectSchema.create({ name, fields: { name: Field.text({}), ...fields, organization_id: Field.text({}) } });
const extend = object => ObjectSchema.create({ ...object, fields: { ...object.fields, organization_id: Field.text({}), owner_id: Field.text({}) } });

test('sales order native actions and approval preserve role, payment and atomic contract invariants', {
  skip: process.env.FORGE_SALES_ORDER_PG_TEST !== '1', timeout: 90_000,
}, async t => {
  const org = randomUUID(), sales = randomUUID(), signature = randomUUID(), finance = randomUUID(), financeReviewer = randomUUID(), operator = randomUUID(), reviewer = randomUUID();
  const system = { ...sys, tenantId: org }, engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'pg', connection: { host: '127.0.0.1', port: Number(process.env.FORGE_SALES_ORDER_PG_PORT || 55439), database: 'forge_sales_order_test', user: 'postgres' } });
  const objects = [
    ...[SalesContract, SalesContractLine, SalesOrder, SalesOrderLine, CustomerPrepayment].map(extend),
    simple('sys_user', { email: Field.text({}), banned: Field.boolean({}), ban_expires: Field.datetime({}) }),
    simple('sys_position', { active: Field.boolean({}) }),
    simple('sys_user_position', { user_id: Field.text({}), position: Field.text({}), valid_from: Field.datetime({}), valid_until: Field.datetime({}) }),
    simple('sys_member', { user_id: Field.text({}) }),
    simple('sys_user_permission_set', { user_id: Field.text({}), permission_set_id: Field.text({}) }),
    simple('sys_organization', {}), simple('forge_customer', {}), simple('forge_contract_type', {}),
    simple('forge_quotation', { status: Field.text({}), customer_acceptance_evidence_attachment: Field.text({}), accepted_pricing_version: Field.number({}), pricing_version: Field.number({}) }),
    simple('forge_fund_account', { status: Field.text({}), current_balance: Field.number({}), opening_balance: Field.number({}) }),
    simple('forge_financial_period', { account_id: Field.text({}), status: Field.text({}), period_start: Field.date({}), period_end: Field.date({}) }),
    simple('forge_cash_receipt', { code: Field.text({}), customer_id: Field.text({}), account_id: Field.text({}), received_on: Field.date({}), payment_method: Field.text({}), amount: Field.number({}), allocated_amount: Field.number({}), unallocated_amount: Field.number({}), counterpart_reference: Field.text({}), status: Field.text({}), responsible_id: Field.text({}), owner_id: Field.text({}) }),
    simple('forge_customer_refund', { prepayment_id: Field.text({}), document_status: Field.text({}), requested_amount: Field.number({}) }),
    extend(SystemFile),
    simple('sys_approval_delegation', SysApprovalDelegation.fields), simple('sys_approval_request', SysApprovalRequest.fields), simple('sys_approval_action', SysApprovalAction.fields), simple('sys_approval_approver', SysApprovalApprover.fields),
  ];
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true); await engine.init(); await driver.initObjects(objects);
  t.after(() => driver.disconnect());
  const files = new Map(), storage = { async download(key) { if (!files.has(key)) throw new Error('file absent'); return files.get(key); } };
  installFileReferenceHooks(engine, () => storage, { warn() {}, error() {}, info() {} });
  const base = { name: 'com.objectstack.engine.objectql', version: '1.0.0', type: 'standard', init(ctx) {
    ctx.registerService('objectql', engine); ctx.registerService('data', engine); ctx.registerService('storage', storage); ctx.registerService('manifest', { register() {} });
    ctx.registerService('http.server', { get() {}, post() {}, put() {}, patch() {}, delete() {} });
    ctx.registerService('notification', { async send() {} });
  } };
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(base).use(new AutomationServicePlugin({ suspendedRunStore: 'memory' })).use(new ApprovalsServicePlugin({ disableAutoHooks: true })).use(new SalesOrderBusinessPlugin()).use(new RecordChangeTriggerPlugin());
  await kernel.bootstrap(); t.after(() => kernel.shutdown());
  kernel.getService('automation').registerFlow(SalesOrderApprovalFlow.name, SalesOrderApprovalFlow);
  const insert = (object, row) => engine.insert(object, { id: randomUUID(), organization_id: org, ...row }, { context: system });
  const read = (object, id) => engine.findOne(object, { where: { id, organization_id: org } }, { context: system });
  await insert('sys_organization', { id: org, name: '隔离订单测试' });
  for (const [id, position] of [[sales, 'sales_owner'], [signature, 'contract_signature_registrar'], [finance, 'finance_receivables_operator'], [financeReviewer, 'finance_reviewer'], [operator, 'sales_order_operator'], [reviewer, 'sales_order_reviewer']]) {
    await insert('sys_user', { id, name: position, email: `${id}@example.invalid` });
    await insert('sys_member', { user_id: id }); await insert('sys_position', { name: position, active: true }); await insert('sys_user_position', { user_id: id, position });
  }
  const customer = randomUUID(), type = randomUUID(), contract = randomUUID(), line = randomUUID(), account = randomUUID();
  await insert('forge_customer', { id: customer, name: '合成客户' }); await insert('forge_contract_type', { id: type, name: '测试类型' });
  await insert('forge_fund_account', { id: account, name: '合成账户', status: 'active', current_balance: 0 });
  await insert('forge_sales_contract', { id: contract, name: '合成合同', code: `TEST-${contract}`, contract_type_id: type, customer_id: customer, responsible_id: sales, owner_id: sales, total_amount: 20000, status: 'active' });
  await insert('forge_sales_contract_line', { id: line, contract_id: contract, name: '交付服务', line_type: 'service', quantity_limit: 20, taxed_unit_price: 1000, taxed_subtotal: 20000 });
  async function action(actor, object, id, target, params = {}) {
    return engine.executeAction(object, target, { record: await read(object, id), recordLoadDenied: false,
      user: { id: actor, organizationId: org }, session: { userId: actor, organizationId: org }, params: { objectName: object, recordId: id, ...params }, engine: {} });
  }
  async function material(actor, name) {
    const id = randomUUID(), key = `attachments/${id}/${name}`, bytes = Buffer.from('%PDF-1.7\nINTERNAL SYNTHETIC TEST'); files.set(key, bytes);
    await insert('sys_file', { id, name, key, status: 'committed', owner_id: actor, scope: 'attachments', size: bytes.length, mime_type: 'application/pdf' }); return id;
  }
  await action(sales, 'forge_sales_contract', contract, ORDER_CONDITIONS_TARGET, { order_payment_requirement: 'prepayment', order_prepayment_amount: 6000 });
  const signInput = { signed_on: '2026-10-03', signed_evidence_attachment: await material(signature, '合成签署.pdf'), signed_evidence_note: '内部测试，不发生真实签署' };
  await action(signature, 'forge_sales_contract', contract, SIGNATURE_TARGET, signInput);
  assert.equal((await action(signature, 'forge_sales_contract', contract, SIGNATURE_TARGET, signInput)).repeated, true);
  await assert.rejects(action(sales, 'forge_sales_contract', contract, ORDER_CONDITIONS_TARGET, { order_payment_requirement: 'none' }), /签署登记前/);
  const orderInput = { code: `SO-${contract}`, name: '合成订单', planned_delivery_on: '2026-10-23', payment_term: '30/30/40', payment_method: 'bank_transfer' };
  await assert.rejects(action(operator, 'forge_sales_contract', contract, CONTRACT_ORDER_TARGET, orderInput), /预付款尚未足额/);
  const prepayInput = { code: `RC-${contract}`, account_id: account, received_on: '2026-10-03', payment_method: 'bank_transfer', amount: 6000, counterpart_reference: `TEST-${contract}`, receipt_evidence_attachment: await material(finance, '合成到账.pdf') };
  const prepay = await action(finance, 'forge_sales_contract', contract, CONTRACT_PREPAYMENT_TARGET, prepayInput);
  assert.equal((await action(finance, 'forge_sales_contract', contract, CONTRACT_PREPAYMENT_TARGET, prepayInput)).repeated, true);
  assert.equal(Number((await read('forge_fund_account', account)).current_balance), 6000);
  await assert.rejects(action(operator, 'forge_sales_contract', contract, CONTRACT_ORDER_TARGET, orderInput), /预付款尚未足额/);
  await assert.rejects(action(finance, 'forge_customer_prepayment', prepay.id, PREPAYMENT_CONFIRM_TARGET, { confirmation_comment: '本人确认' }), /岗位|独立/);
  await action(financeReviewer, 'forge_customer_prepayment', prepay.id, PREPAYMENT_CONFIRM_TARGET, { confirmation_comment: '合成凭证与金额核对一致' });
  const created = await action(operator, 'forge_sales_contract', contract, CONTRACT_ORDER_TARGET, orderInput);
  assert.equal((await action(operator, 'forge_sales_contract', contract, CONTRACT_ORDER_TARGET, orderInput)).id, created.id);
  assert.equal((await read('forge_customer_prepayment', prepay.id)).order_id, created.id);
  const existing = await engine.find('forge_sales_order_line', { where: { order_id: created.id } }, { context: system });
  const duplicateId = randomUUID(); await insert('forge_sales_order_line', { ...existing[0], id: duplicateId });
  await assert.rejects(action(operator, 'forge_sales_order', created.id, ORDER_SUBMIT_TARGET), /明细来源、数量或价格/);
  await engine.delete('forge_sales_order_line', { where: { id: duplicateId }, context: system });
  await action(operator, 'forge_sales_order', created.id, ORDER_SUBMIT_TARGET);
  let request;
  for (let n = 0; n < 40; n++) {
    request = await engine.findOne('sys_approval_request', { where: { record_id: created.id, organization_id: org } }, { context: system });
    if (request) break; await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(request); assert.equal(request.submitter_id, operator);
  const approvals = kernel.getService('approvals');
  const reviewContext = { userId: reviewer, tenantId: org, permissions: [], positions: [] };
  const auditBefore = await approvals.listActions(request.id, reviewContext);
  const pendingBefore = (await read('sys_approval_request', request.id)).pending_approvers;
  await assert.rejects(approvals.reassign(request.id, { actorId: reviewer, to: operator, comment: '不应改派订单' }, reviewContext), /仅支持同意或拒绝/);
  await assert.rejects(approvals.sendBack(request.id, { actorId: reviewer, comment: '不应退回订单' }, reviewContext), /仅支持同意或拒绝/);
  await assert.rejects(approvals.requestInfo(request.id, { actorId: reviewer, comment: '不应新增退回补充' }, reviewContext), /仅支持同意或拒绝/);
  const visibleRequest = approvals.getRequest;
  approvals.getRequest = async () => null;
  try {
    await assert.rejects(approvals.reassign(request.id, { actorId: reviewer, to: operator }, reviewContext), /仅支持同意或拒绝/);
    await assert.rejects(approvals.requestInfo(request.id, { actorId: reviewer, comment: '隐藏投影不能绕过守卫' }, reviewContext), /仅支持同意或拒绝/);
    await assert.rejects(approvals.decide(request.id, { actorId: operator, decision: 'approve', comment: '隐藏投影不能自审' }, { ...reviewContext, userId: operator }), /独立员工/);
  } finally { approvals.getRequest = visibleRequest; }
  assert.deepEqual((await read('sys_approval_request', request.id)).pending_approvers, pendingBefore);
  assert.deepEqual(await approvals.listActions(request.id, reviewContext), auditBefore, 'unsupported toolbar operations leave no audit or routing effects');
  assert.equal((await read('forge_sales_order', created.id)).status, 'pending_approval');
  await assert.rejects(approvals.decide(request.id, { actorId: operator, decision: 'approve', comment: '自审' }, { userId: operator, tenantId: org, permissions: [], positions: [] }), /独立员工/);
  const nativeUpdate = engine.update;
  let inject = true;
  engine.update = async function (object, data, opts) {
    if (inject && object === 'forge_sales_order' && data.status === 'active') { inject = false; throw new Error('injected final-order write failure'); }
    return nativeUpdate.call(this, object, data, opts);
  };
  try { const decided = await approvals.decide(request.id, { actorId: reviewer, decision: 'approve', comment: '合成订单复核通过' }, { userId: reviewer, tenantId: org, permissions: [], positions: [] }); assert.equal(decided.request.status, 'approved'); } catch (error) { assert.match(String(error), /injected final-order write failure/); }
  engine.update = nativeUpdate;
  assert.equal(inject, false, 'fault injection reached the last business write');
  assert.equal((await read('forge_sales_order', created.id)).status, 'pending_approval');
  assert.equal(Number((await read('forge_sales_contract', contract)).ordered_amount), 0);
  assert.equal(Number((await read('forge_sales_contract_line', line)).ordered_quantity), 0);
  assert.equal((await read('sys_approval_request', request.id)).status, 'approved', 'native approval is durable independently of failed business activation');
  await action(operator, 'forge_sales_order', created.id, ORDER_APPLY_APPROVAL_TARGET);
  await action(operator, 'forge_sales_order', created.id, ORDER_APPLY_APPROVAL_TARGET);
  assert.equal((await read('forge_sales_order', created.id)).status, 'active');
  assert.equal(Number((await read('forge_sales_contract', contract)).ordered_amount), 20000);
  assert.equal(Number((await read('forge_sales_contract', contract)).ordered_count), 1);
  assert.equal(Number((await read('forge_sales_contract_line', line)).ordered_quantity), 20);
  const rejectedContract=randomUUID(), rejectedLine=randomUUID();
  await insert('forge_sales_contract',{id:rejectedContract,name:'合成拒绝合同',code:`REJECT-${rejectedContract}`,contract_type_id:type,customer_id:customer,responsible_id:sales,owner_id:sales,total_amount:20000,status:'active'});
  await insert('forge_sales_contract_line',{id:rejectedLine,contract_id:rejectedContract,name:'交付服务',line_type:'service',quantity_limit:20,taxed_unit_price:1000,taxed_subtotal:20000});
  await action(sales,'forge_sales_contract',rejectedContract,ORDER_CONDITIONS_TARGET,{order_payment_requirement:'prepayment',order_prepayment_amount:6000});
  await action(signature,'forge_sales_contract',rejectedContract,SIGNATURE_TARGET,{...signInput,signed_evidence_attachment:await material(signature,'合成拒绝签署.pdf')});
  const secondPrepay=await action(finance,'forge_sales_contract',rejectedContract,CONTRACT_PREPAYMENT_TARGET,{...prepayInput,code:`RC-${rejectedContract}`,counterpart_reference:`TEST-${rejectedContract}`,receipt_evidence_attachment:await material(finance,'合成拒绝到账.pdf')});
  await action(financeReviewer,'forge_customer_prepayment',secondPrepay.id,PREPAYMENT_CONFIRM_TARGET,{confirmation_comment:'仅内部合成凭证核对'});
  const secondOrder=await action(operator,'forge_sales_contract',rejectedContract,CONTRACT_ORDER_TARGET,{...orderInput,code:`SO-${rejectedContract}`});
  await action(operator,'forge_sales_order',secondOrder.id,ORDER_SUBMIT_TARGET);
  const secondRequest=await engine.findOne('sys_approval_request',{where:{record_id:secondOrder.id,organization_id:org}},{context:system});
  assert.ok(secondRequest);
  await approvals.decide(secondRequest.id,{actorId:reviewer,decision:'reject',comment:'拒绝分支合成验证'},{userId:reviewer,tenantId:org,permissions:[],positions:[]});
  assert.equal((await read('forge_sales_order',secondOrder.id)).status,'cancelled');
  assert.equal((await read('forge_customer_prepayment',secondPrepay.id)).order_id,null,'rejection releases the same prepayment for a corrected order');
  assert.equal(Number((await read('forge_sales_contract',rejectedContract)).ordered_amount),0);
  const replacement=await action(operator,'forge_sales_contract',rejectedContract,CONTRACT_ORDER_TARGET,{...orderInput,code:`REPLACE-${rejectedContract}`});
  assert.ok(replacement.id!==secondOrder.id);

  await action(operator,'forge_sales_order',replacement.id,ORDER_SUBMIT_TARGET);
  const recallRequest=await engine.findOne('sys_approval_request',{where:{record_id:replacement.id,organization_id:org}},{context:system});
  assert.ok(recallRequest);
  await approvals.recall(recallRequest.id,{actorId:operator,reason:'合成原生撤回验证'},{userId:operator,tenantId:org,permissions:[],positions:[]});
  assert.equal((await read('sys_approval_request',recallRequest.id)).status,'recalled');
  assert.equal((await read('forge_sales_order',replacement.id)).status,'cancelled');
  assert.equal((await read('forge_sales_order',replacement.id)).approval_outcome,'recalled');
  assert.equal((await read('forge_customer_prepayment',secondPrepay.id)).order_id,null);
  await action(operator,'forge_sales_order',replacement.id,ORDER_APPLY_APPROVAL_TARGET);

});
