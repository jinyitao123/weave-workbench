import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceWorkspacePage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceNodes } from './service-page-react-harness.mjs';

function globals() {
  function DocumentWorkspace() {}
  function DataEmptyState() {}
  return { DocumentWorkspace, DataEmptyState };
}

function sidebar(tree) {
  const workspace = serviceNodes(tree, node => node.type === 'DocumentWorkspace')[0];
  return workspace && serviceNodes(workspace.props.sidebar, node => node.type === 'ListSummary' && node.props['aria-label'] === '个人业务摘要')[0];
}

test('quotation and parts summary selection restore status filters without re-querying unscoped data', async () => {
  const actor = 'metric-page-actor';
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager:true, users:{id:actor}, permissions:serviceManagerPermission.systemPermissions,
    globals:globals(), records:{
      forge_service_order:[{id:'order-own',engineer_id:actor,status:'completed'}],
      forge_service_quotation:[{id:'quote-own',service_order_id:'order-own',status:'draft',total_amount:123}],
      forge_service_part_request:[{id:'part-own',requested_by:actor,status:'open'}],
    },
    onAction:async({path})=>path==='/actions/global/organization_business_date_query'?{business_date:'2026-10-05'}:{},
  });
  let tree=await harness.flushEffects();
  let tabs=serviceNodes(tree,n=>n.type==='StatusTabs'&&n.props['aria-label']==='接单中心工作范围')[0];
  tabs.props.onValueChange('my-quotations');
  tree=await harness.flushEffects();
  const summary=serviceNodes(tree,n=>n.type==='ListSummary'&&n.props['aria-label']==='个人报价统计')[0];
  assert.ok(summary);
  assert.equal(summary.props.items.find(i=>i.id==='all').value,1);
  assert.equal(summary.props.items.find(i=>i.id==='executing').value,'—');
  assert.equal(summary.props.items.find(i=>i.id==='executing').disabled,true);
  assert.equal(summary.props.items.find(i=>i.id==='valid_amount').value,'—');
  summary.props.onItemSelect('draft');
  tree=harness.render();
  let list=serviceNodes(tree,n=>n.type==='ListView')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.filters)),['service_order_id','in',['order-own']]);
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.userFilterSelections)),{status:['draft']});
  const requests=harness.calls.filter(c=>c.path==='/data/forge_service_quotation');
  assert.ok(requests.length);
  assert.ok(requests.every(c=>JSON.parse(new URLSearchParams(c.url.split('?')[1]).get('$filter')).service_order_id.$in.includes('order-own')));

  tabs=serviceNodes(tree,n=>n.type==='StatusTabs'&&n.props['aria-label']==='接单中心工作范围')[0];
  tabs.props.onValueChange('parts');
  tree=await harness.flushEffects();
  const parts=serviceNodes(tree,n=>n.type==='ListSummary'&&n.props['aria-label']==='个人备件统计')[0];
  assert.ok(parts);
  assert.equal(parts.props.items.find(i=>i.id==='open').value,1);
  parts.props.onItemSelect('completed');
  tree=harness.render();
  list=serviceNodes(tree,n=>n.type==='ListView')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.filters)),['requested_by','=',actor]);
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.userFilterSelections)),{status:['completed']});
  assert.equal(harness.calls.some(c=>c.method==='POST'&&/service_quotation_confirm|service_part_request_(outbound|receive|use)/.test(c.path)),false);
});

test('a denied metrics read does not replace unavailable counts with zero', async () => {
  const actor='denied-metric-actor';
  const transport=async(url)=>{
    const u=new URL(url),p=u.pathname.replace('/api/v1','');
    const value=p==='/auth/get-session'?{user:{id:actor}}:
      p==='/auth/me/permissions'?{systemPermissions:serviceManagerPermission.systemPermissions}:
      p==='/actions/forge_service_order/service_order_manager_context'?{canManage:true}:
      p==='/actions/global/organization_business_date_query'?{business_date:'2026-10-05'}:
      p==='/data/forge_service_order'?{records:[{id:'order-own',engineer_id:actor,status:'completed'}],total:1}:{};
    const status=p==='/data/forge_service_quotation'?403:200;
    return {ok:status===200,status,json:async()=>value};
  };
  const harness=createServicePageHarness(ServiceWorkspacePage,{manager:true,users:{id:actor},transport,globals:globals()});
  let tree=await harness.flushEffects();
  const tabs=serviceNodes(tree,n=>n.type==='StatusTabs'&&n.props['aria-label']==='接单中心工作范围')[0];
  tabs.props.onValueChange('my-quotations');
  tree=await harness.flushEffects();
  assert.equal(serviceNodes(tree,n=>n.type==='ListSummary'&&n.props['aria-label']==='个人报价统计').length,0);
  assert.ok(serviceNodes(tree,n=>n.type==='ForgeNotice'&&n.props.tone==='error').length);
});

test('Today sidebar uses complete actor scopes and navigates without inventing a status selection', async () => {
  const actor = 'sidebar-actor';
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true, users: { id: actor }, permissions: serviceManagerPermission.systemPermissions,
    globals: globals(), records: {
      forge_service_order: [
        { id: 'assigned', engineer_id: actor, status: 'pending_receive' },
        { id: 'peer-order', engineer_id: 'peer', status: 'pending_receive' },
      ],
      forge_service_quotation: [{ id: 'peer-quote', service_order_id: 'peer-order', status: 'draft' }],
      forge_service_part_request: [
        { id: 'own-open', requested_by: actor, status: 'open' },
        { id: 'own-done', requested_by: actor, status: 'completed' },
        { id: 'peer-open', requested_by: 'peer', status: 'open' },
      ],
    }, onAction: ({path}) => path === '/actions/global/organization_business_date_query' ? { business_date: '2026-10-06', timezone: 'Asia/Shanghai' } : {},
  });
  let tree = await harness.flushEffects();
  let cards = sidebar(tree);
  assert.equal(cards.props.variant, 'compact');
  assert.deepEqual(JSON.parse(JSON.stringify(cards.props.items.map(item => item.value))), [1, 1, 0]);
  assert.equal(cards.props.onItemSelect, undefined, 'navigation cards are not status toggles');
  const partsReads = harness.calls.filter(call => call.path === '/data/forge_service_part_request');
  const quoteReads = harness.calls.filter(call => call.path === '/data/forge_service_quotation');
  assert.ok(partsReads.length && quoteReads.length);
  assert.ok(partsReads.every(call => JSON.parse(new URLSearchParams(call.url.split('?')[1]).get('$filter')).requested_by === actor));
  assert.ok(quoteReads.every(call => JSON.parse(new URLSearchParams(call.url.split('?')[1]).get('$filter')).service_order_id.$in.join(',') === 'assigned'));

  cards.props.onItemActivate('my-orders');
  tree = await harness.flushEffects();
  let list = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.filters)), ['engineer_id', '=', actor]);
  let tabs = serviceNodes(tree, node => node.type === 'StatusTabs')[0];
  tabs.props.onValueChange('today');
  tree = await harness.flushEffects();
  cards = sidebar(tree);
  cards.props.onItemActivate('my-quotations');
  tree = await harness.flushEffects();
  list = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.filters)), ['service_order_id', 'in', ['assigned']]);
  assert.equal(list.props.userFilterSelections, undefined, 'pending card does not add an unobserved quotation status filter');
  assert.equal(list.props.userActions.refresh, false);
  assert.equal(list.props.mobileLayout, 'table', 'the quotation list keeps its columns available at narrow widths');
  list.props.onUserFilterSelectionsChange({ status: ['draft'] });
  tree = harness.render();
  tabs = serviceNodes(tree, node => node.type === 'StatusTabs')[0];
  tabs.props.onValueChange('today');
  tree = await harness.flushEffects();
  sidebar(tree).props.onItemActivate('my-quotations');
  tree = await harness.flushEffects();
  list = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.userFilterSelections)), { status: ['draft'] }, 'card navigation preserves the user’s prior list state');
  assert.equal(harness.calls.some(call => call.method !== 'GET' && call.path.startsWith('/data/')), false);
});

test('an engineer sidebar never reads quotes and leaves the inaccessible card disabled', async () => {
  const actor = 'sidebar-engineer';
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    users: { id: actor }, globals: globals(), records: {
      forge_service_order: [], forge_service_part_request: [],
    }, onAction: ({path}) => path === '/actions/global/organization_business_date_query' ? { business_date: '2026-10-06', timezone: 'Asia/Shanghai' } : {},
  });
  const tree = await harness.flushEffects();
  const cards = sidebar(tree);
  assert.equal(cards.props.items[1].value, 0);
  assert.equal(cards.props.items[2].value, '—');
  assert.equal(cards.props.items[2].disabled, true);
  assert.equal(harness.calls.some(call => call.path === '/data/forge_service_quotation'), false);
});

test('a denied sidebar read stays unavailable while other complete counts remain readable, then retries in scope', async () => {
  const actor = 'sidebar-retry';
  let denyParts = true;
  const transport = async url => {
    const parsed = new URL(url), path = parsed.pathname.replace('/api/v1', '');
    const payload = path === '/auth/get-session' ? { user: { id: actor } }
      : path === '/auth/me/permissions' ? { systemPermissions: serviceManagerPermission.systemPermissions }
      : path === '/actions/forge_service_order/service_order_manager_context' ? { canManage: true }
      : path === '/actions/global/organization_business_date_query' ? { business_date: '2026-10-06', timezone: 'Asia/Shanghai' }
      : { records: [], total: 0 };
    const status = path === '/data/forge_service_part_request' && denyParts ? 403 : 200;
    return { ok: status === 200, status, json: async () => payload };
  };
  const harness = createServicePageHarness(ServiceWorkspacePage, { transport, globals: globals() });
  let tree = await harness.flushEffects();
  let cards = sidebar(tree);
  assert.deepEqual(JSON.parse(JSON.stringify(cards.props.items.map(item => item.value))), [0, '—', 0]);
  const workspace = serviceNodes(tree, node => node.type === 'DocumentWorkspace')[0];
  const retry = serviceNodes(workspace.props.sidebar, node => node.type === 'button' && node.children.join('') === '重试')[0];
  assert.ok(retry);
  denyParts = false;
  retry.props.onClick();
  tree = await harness.flushEffects();
  cards = sidebar(tree);
  assert.deepEqual(JSON.parse(JSON.stringify(cards.props.items.map(item => item.value))), [0, 0, 0]);
  assert.ok(harness.calls.filter(call => call.path === '/data/forge_service_part_request').every(call => JSON.parse(new URLSearchParams(call.url.split('?')[1]).get('$filter')).requested_by === actor));
});

test('sidebar follows all pages and a late response cannot restore stale counts after a scope change', async () => {
  const actor = 'sidebar-paging';
  let releaseFirst;
  let holdFirst = true;
  let parts = Array.from({ length: 201 }, (_, index) => ({ id: 'part-' + index, requested_by: actor, status: 'open' }));
  const transport = async url => {
    const parsed = new URL(url), path = parsed.pathname.replace('/api/v1', '');
    let payload = path === '/auth/get-session' ? { user: { id: actor } }
      : path === '/auth/me/permissions' ? { systemPermissions: serviceManagerPermission.systemPermissions }
      : path === '/actions/forge_service_order/service_order_manager_context' ? { canManage: true }
      : path === '/actions/global/organization_business_date_query' ? { business_date: '2026-10-06', timezone: 'Asia/Shanghai' }
      : { records: [], total: 0 };
    if (path === '/data/forge_service_part_request') {
      const skip = Number(parsed.searchParams.get('$skip') || 0), top = Number(parsed.searchParams.get('$top') || 100);
      payload = { records: parts.slice(skip, skip + top), total: parts.length };
      if (holdFirst) {
        holdFirst = false;
        await new Promise(resolve => { releaseFirst = resolve; });
      }
    }
    return { ok: true, status: 200, json: async () => payload };
  };
  const harness = createServicePageHarness(ServiceWorkspacePage, { transport, globals: globals() });
  const firstLoad = harness.flushEffects();
  for (let attempt = 0; !releaseFirst && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(releaseFirst, 'first sidebar request is live');
  let tree = harness.render();
  serviceNodes(tree, node => node.type === 'StatusTabs')[0].props.onValueChange('my-orders');
  const leaving = harness.flushEffects();
  releaseFirst();
  await Promise.all([firstLoad, leaving]);
  tree = harness.render();
  assert.equal(sidebar(tree), undefined, 'late summary response does not mount a card in another scope');

  tree = harness.render();
  serviceNodes(tree, node => node.type === 'StatusTabs')[0].props.onValueChange('today');
  tree = await harness.flushEffects();
  assert.equal(sidebar(tree).props.items[1].value, 201, 'all three pages are included');
  parts = [{ id: 'completed-later', requested_by: actor, status: 'completed' }];
  sidebar(tree).props.onItemActivate('my-orders');
  tree = await harness.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs')[0].props.onValueChange('today');
  tree = await harness.flushEffects();
  assert.equal(sidebar(tree).props.items[1].value, 0, 'returning to Today rereads current business state');
  assert.ok(harness.calls.some(call => call.path === '/data/forge_service_part_request' && new URLSearchParams(call.url.split('?')[1]).get('$skip') === '200'));
});
