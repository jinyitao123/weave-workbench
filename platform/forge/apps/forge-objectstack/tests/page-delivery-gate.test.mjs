import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkPageDelivery, repositoryIO } from './page-delivery-gate.mjs';
import { execFileSync } from 'node:child_process';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function solidPng(width, height, rgba = [255, 255, 255, 255]) {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0]; image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2]; image.data[offset + 3] = rgba[3];
  }
  return image;
}

function pixelFixture(files, kind, viewport, crop) {
  const reference = solidPng(viewport.width, viewport.height);
  const forge = solidPng(viewport.width, viewport.height);
  const referenceCrop = new PNG({ width: crop.width, height: crop.height });
  const forgeCrop = new PNG({ width: crop.width, height: crop.height });
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const sourceOffset = ((crop.y + y) * viewport.width + crop.x + x) * 4;
    const targetOffset = (y * crop.width + x) * 4;
    reference.data.copy(referenceCrop.data, targetOffset, sourceOffset, sourceOffset + 4);
    forge.data.copy(forgeCrop.data, targetOffset, sourceOffset, sourceOffset + 4);
  }
  const diff = new PNG({ width: crop.width, height: crop.height });
  pixelmatch(referenceCrop.data, forgeCrop.data, diff.data, crop.width, crop.height, { threshold: 0.1 });
  const paths = {
    risemap: `evidence/${kind}-risemap.png`, forge: `evidence/${kind}-forge.png`, diff: `evidence/${kind}-diff.png`,
    risemapGeometry: `evidence/${kind}-risemap-geometry.json`, forgeGeometry: `evidence/${kind}-forge-geometry.json`,
  };
  files.set(paths.risemap, PNG.sync.write(reference));
  files.set(paths.forge, PNG.sync.write(forge));
  files.set(paths.diff, PNG.sync.write(diff));
  const geometry = {
    viewport: { ...viewport, scale: 1 }, crop,
    elements: [
      { id: 'title', x: 10, y: 10, width: 100, height: 20 },
      { id: 'toolbar', x: 10, y: 40, width: Math.min(200, crop.width - 20), height: 30 },
      { id: 'filters', x: 10, y: 80, width: crop.width - 20, height: 50 },
      { id: 'table', x: 10, y: 140, width: crop.width - 20, height: 120 },
      { id: 'pagination', x: 10, y: 270, width: crop.width - 20, height: 30 },
    ],
  };
  files.set(paths.risemapGeometry, Buffer.from(JSON.stringify(geometry)));
  files.set(paths.forgeGeometry, Buffer.from(JSON.stringify(geometry)));
  return { kind, viewport: { ...viewport, scale: 1 }, crop, risemap: [paths.risemap], forge: [paths.forge], diff: [paths.diff], geometry: { risemap: [paths.risemapGeometry], forge: [paths.forgeGeometry] }, tool: 'pixelmatch 7.2.0', mismatchedPixelRatio: 0, maxGeometryDeltaPx: 0, exclusions: [] };
}

function fixture() {
  const sourcePaths = [
    'apps/forge-objectstack/src/pages/example.page.ts',
    'apps/forge-objectstack/src/pages/product-ui.ts',
    'apps/forge-objectstack/src/pages/project-timesheet-cost.page.ts',
    'docs/forge-page-polish-baseline.md',
  ];
  const files = new Map(sourcePaths.map(name => [name, Buffer.from(`source: ${name}`)]));
  files.set('docs/contract.md', Buffer.from('Page requirements'));
  files.set('docs/report.md', Buffer.from('Observed results'));
  const evidence = ['docs/report.md'];
  const desktop = pixelFixture(files, 'desktop', { width: 1440, height: 900 }, { x: 0, y: 80, width: 1440, height: 820, reason: 'business content' });
  const narrow = pixelFixture(files, 'narrow', { width: 390, height: 844 }, { x: 0, y: 60, width: 390, height: 784, reason: 'business content' });
  const record = {
    schemaVersion: 2, pageId: 'page_example', archetype: 'timesheet_composite',
    reviewedRevision: 'a'.repeat(40),
    subjectFiles: Object.fromEntries(sourcePaths.map(name => [name, createHash('sha256').update(files.get(name)).digest('hex')])),
    environment: { forgeUrl: 'http://localhost:4499', database: '.objectstack/example.sqlite', materials: 'CASE-001' },
    checks: Object.fromEntries(['replication', 'visual', 'interaction', 'business'].map(key => [key, { status: 'pass', notes: 'Observed result', evidence }])),
    visualEvidence: {
      desktop: { width: 1440, height: 900, evidence }, narrow: { width: 390, height: 844, evidence },
      reference: evidence, populated: evidence, empty: evidence, form: evidence, error: evidence,
    },
    pixelComparisons: [desktop, narrow],
    requirements: [{ id: 'REQ-001', status: 'pass', steps: 'Submit', expected: 'Saved', observed: 'Saved and read back', evidence }],
    review: { implementer: 'builder', reviewer: 'reviewer', status: 'pass', reviewedAt: '2026-09-16', evidence },
  };
  const entry = { file: 'example.page.ts', pages: ['page_example'], archetype: 'timesheet_composite', reference: 'project-timesheet-cost.page.ts', designStatus: 'accepted', contract: 'docs/contract.md', evidence: 'docs/report.md', acceptance: 'docs/record.json' };
  const historical = new Map(files);
  const io = {
    async read(name) {
      if (name === 'docs/record.json') return Buffer.from(JSON.stringify(record));
      if (!files.has(name)) throw new Error('missing');
      return files.get(name);
    },
    async atRevision(revision, name) {
      if (revision !== 'a'.repeat(40) || !historical.has(name)) throw new Error('missing revision');
      return historical.get(name);
    },
  };
  return { entry, record, files, historical, io, check: () => checkPageDelivery(entry, io) };
}

function v3Fixture({ surfaceType = 'action', target = 'goods_receipt.post', stateEffect = 'writes_business_state' } = {}) {
  const revision = 'c'.repeat(40);
  const sourcePaths = [
    'apps/forge-objectstack/src/actions/goods-receipt.action.ts',
    'apps/forge-objectstack/src/objects/goods-receipt.object.ts',
    'apps/forge-objectstack/src/views/goods-receipt.view.ts',
    'apps/forge-objectstack/src/apps/supply-chain.app.ts',
  ];
  const files = new Map(sourcePaths.map(name => [name, Buffer.from(`source: ${name}`)]));
  const evidenceCounter = { value: 0 };
  const featureId = 'supply-chain.goods-receipt-post';
  const materialId = 'CASE-GATE-001';
  function addEvidence(label, kind, method, extra = {}) {
    const extension = kind === 'forge_screenshot' ? 'png' : 'json';
    const path = `docs/evidence/v3-${++evidenceCounter.value}.${extension}`;
    const item = {
      path, kind, claim: label, method, actor: 'operator-01', role: 'warehouse_operator',
      materialId, capturedAt: '2026-09-23T11:00:00+08:00', revision, featureId, target,
      ...extra,
    };
    if (extension === 'png') {
      files.set(path, PNG.sync.write(solidPng(item.viewport.width, item.viewport.height)));
    } else {
      files.set(path, Buffer.from(JSON.stringify({
        featureId, target, materialId, revision, actor: item.actor, role: item.role, claim: item.claim, method: item.method,
        decision: item.decision, database: item.database, databaseType: item.databaseType,
      })));
    }
    return item;
  }
  const simpleEvidence = label => addEvidence(label, 'manual_observation', 'observed_in_forge');
  const checks = Object.fromEntries(['requirements', 'visual', 'interaction', 'business', 'permissions', 'persistence', 'performance']
    .map(key => [key, { status: 'pass', notes: `Observed ${key}`, evidence: [simpleEvidence(key)] }]));
  checks.visual.evidence = [
    addEvidence('Desktop Forge capture', 'forge_screenshot', 'browser_capture', { viewport: { class: 'desktop', width: 1440, height: 900 } }),
    addEvidence('Narrow Forge capture', 'forge_screenshot', 'browser_capture', { viewport: { class: 'narrow', width: 390, height: 844 } }),
  ];
  checks.interaction.evidence = [addEvidence('Normal UI path', 'interaction_recording', 'live_forge_ui')];
  checks.business.evidence = [addEvidence('Independent result readback', 'business_result_readback', 'independent_forge_readback')];
  const allowedRole = {
    role: 'warehouse_operator', principal: 'operator-01', action: 'goods_receipt.post',
    expected: 'allowed', actual: 'allowed', status: 'pass',
    evidence: [addEvidence('Authorized operator can post', 'permission_attempt', 'role_permission_check', { role: 'warehouse_operator' })],
  };
  const deniedRole = {
    role: 'sales_viewer', principal: 'viewer-02', action: 'goods_receipt.post',
    expected: 'denied', actual: 'denied', status: 'pass',
    evidence: [addEvidence('Viewer cannot post', 'permission_attempt', 'role_permission_check', { role: 'sales_viewer', actor: 'viewer-02' })],
  };
  checks.permissions.roles = [allowedRole, deniedRole];
  const restartReadback = addEvidence('Same database after full restart', 'restart_readback', 'complete_stop_restart_readback', {
    database: '.objectstack/gate-v3.sqlite', databaseType: 'sqlite',
  });
  checks.persistence.scope = 'required';
  checks.persistence.evidence = [restartReadback];
  checks.performance.metrics = [
    ['coldOpenMs', 880, 1800], ['refreshMs', 420, 1200], ['navigationMs', 190, 600],
    ['requestCount', 18, 30], ['transferBytes', 240000, 500000],
  ].map(([name, value, budget]) => ({
    name, value, budget, budgetSource: 'forge-page-delivery-standard.md', status: 'pass',
    evidence: [addEvidence(`${name} trace`, 'performance_trace', 'fixed_material_performance_run')],
  }));
  const record = {
    schemaVersion: 3, featureId, app: 'supply-chain', surfaceType, target,
    ...(surfaceType === 'page' ? { pageId: target } : {}),
    reviewedRevision: revision,
    subjectFiles: Object.fromEntries(sourcePaths.map(name => [name, createHash('sha256').update(files.get(name)).digest('hex')])) ,
    environment: {
      forgeUrl: 'http://127.0.0.1:4611', databaseType: 'sqlite', database: '.objectstack/gate-v3.sqlite',
      materials: [{ id: materialId, name: '门禁验收材料' }],
    },
    designBaseline: { revision: 'forge-baseline-2026-09', evidence: [addEvidence('Forge visual baseline', 'design_baseline', 'baseline_document_review')] },
    referenceEvidence: [], checks,
    requirements: [{
      id: 'REQ-001', source: { type: 'forge_decision', reference: '收货办理合同' },
      statement: '仓库人员可以按正式收货材料完成入库', subjectFiles: [sourcePaths[0], sourcePaths[1]],
      steps: ['打开收货单', '提交入库', '独立查看正式结果'], expected: '库存形成对应入库记录',
      actual: '库存形成对应入库记录', stateEffect, status: 'pass',
      evidence: [addEvidence('Requirement execution', 'business_result_readback', 'independent_forge_readback')],
    }],
    settingsConsumers: [],
    review: {
      implementer: 'builder-01', reviewer: 'reviewer-02', reviewedAt: '2026-09-23T11:30:00+08:00',
      reviewedRevision: revision, status: 'pass', decision: 'accepted',
      evidence: [addEvidence('Independent review decision', 'independent_review', 'reviewed_subject_and_evidence', {
        actor: 'reviewer-02', role: 'independent_reviewer', decision: 'accepted',
      })],
    },
  };
  const entry = {
    featureId, app: 'supply-chain', surfaceType, target, subjectFiles: sourcePaths, requirementIds: ['REQ-001'],
    designStatus: 'accepted', acceptance: 'docs/acceptance/v3-record.json',
  };
  const historical = new Map(files);
  const io = {
    async read(name) {
      if (name === entry.acceptance) return Buffer.from(JSON.stringify(record));
      if (!files.has(name)) throw new Error('missing');
      return files.get(name);
    },
    async atRevision(commit, name) {
      if (commit !== revision || !historical.has(name)) throw new Error('missing revision');
      return historical.get(name);
    },
  };
  return { entry, record, files, historical, io, check: () => checkPageDelivery(entry, io), addEvidence };
}

test('complete record passes; legacy review debt remains visibly unaccepted', async () => {
  const f = fixture();
  assert.deepEqual(await f.check(), []);
  assert.deepEqual(await checkPageDelivery({ designStatus: 'review_required' }, f.io), []);
});

test('schemaVersion 1 partial and schemaVersion 2 accepted history keep their original validation path', async () => {
  const f = fixture();
  assert.deepEqual(await f.check(), []);
  f.entry.designStatus = 'review_required';
  f.record.schemaVersion = 1;
  assert.deepEqual(await f.check(), []);
});

test('schemaVersion 3 accepts native actions without pageId or React page files and without RISEMAP evidence', async () => {
  const f = v3Fixture();
  assert.deepEqual(await f.check(), []);
});

test('schemaVersion 3 binds a custom pageId only for a page surface', async () => {
  const page = v3Fixture({ surfaceType: 'page', target: 'page_goods_receipt' });
  assert.deepEqual(await page.check(), []);
  const action = v3Fixture();
  action.record.pageId = 'page_goods_receipt';
  assert.ok((await action.check()).some(error => error.includes('只有 surfaceType=page')));
});

test('schemaVersion 3 rejects path-only fake acceptance and incomplete dimension evidence', async () => {
  const f = v3Fixture();
  f.record.checks.visual.evidence = [];
  f.record.checks.business.evidence = [f.addEvidence('API only', 'business_result_readback', 'direct_api_readback')];
  f.record.checks.permissions.roles = [];
  f.record.checks.persistence.evidence = [];
  f.record.review.reviewer = f.record.review.implementer;
  f.record.review.evidence = [];
  const errors = await f.check();
  for (const token of ['Forge desktop', 'Forge narrow', '独立 Forge 业务结果回读', '两个真实角色', 'persistence: 缺少结构化证据', '独立复核']) {
    assert.ok(errors.some(error => error.includes(token)), token);
  }
});

test('schemaVersion 3 rejects accepted claims and success reports while manifest remains review_required', async () => {
  const f = v3Fixture();
  f.entry.designStatus = 'review_required';
  f.entry.evidence = 'docs/evidence/overall-success.md';
  let errors = await f.check();
  assert.ok(errors.some(error => error.includes('不得附带总体成功报告')));
  assert.ok(errors.some(error => error.includes('结构化 accepted 决议冲突')));
  delete f.entry.evidence;
  f.record.review.decision = 'pending';
  f.record.review.status = 'pending';
  f.record.review.evidence = [];
  assert.deepEqual(await f.check(), []);
});

test('schemaVersion 3 rejects wrong target/version and files outside the declared feature scope', async () => {
  const f = v3Fixture();
  f.record.target = 'unrelated.invoice.export';
  f.record.subjectFiles['apps/forge-objectstack/src/pages/unrelated.page.ts'] = createHash('sha256')
    .update(Buffer.from('unrelated')).digest('hex');
  f.files.set('apps/forge-objectstack/src/pages/unrelated.page.ts', Buffer.from('unrelated'));
  const visual = f.record.checks.visual.evidence[0];
  visual.revision = 'b'.repeat(40);
  const errors = await f.check();
  for (const token of ['target 与 manifest 不一致', '受验文件与 manifest 声明范围不一致', '证据版本与 reviewedRevision 不一致']) {
    assert.ok(errors.some(error => error.includes(token)), token);
  }
});

test('schemaVersion 3 rejects a commit that cannot provide the reviewed source version', async () => {
  const f = v3Fixture();
  f.record.reviewedRevision = 'd'.repeat(40);
  const errors = await f.check();
  for (const token of ['无法读取被验收提交中的文件', 'reviewedRevision 与验收版本不一致', '证据版本与 reviewedRevision 不一致']) {
    assert.ok(errors.some(error => error.includes(token)), token);
  }
});

test('schemaVersion 3 rejects self-reported hashes and evidence detached from its recorded feature', async () => {
  const f = v3Fixture();
  const sourcePath = Object.keys(f.record.subjectFiles)[0];
  const changedSource = Buffer.from('changed after the reviewed revision');
  f.files.set(sourcePath, changedSource);
  f.record.subjectFiles[sourcePath] = createHash('sha256').update(changedSource).digest('hex');
  const resultEvidence = f.record.checks.business.evidence[0];
  f.files.set(resultEvidence.path, Buffer.from(JSON.stringify({
    featureId: 'another.feature', target: 'other.target', materialId: 'OTHER',
    revision: 'e'.repeat(40), actor: 'unknown', claim: 'unrelated', method: 'unrelated', role: 'unknown',
  })));
  const errors = await f.check();
  assert.ok(errors.some(error => error.includes('与被验收版本不匹配')));
  assert.ok(errors.some(error => error.includes('JSON 证据 featureId 与证据登记不一致')));
});

test('schemaVersion 3 requires restart readback when a requirement changes persisted state', async () => {
  const f = v3Fixture();
  f.record.checks.persistence.scope = 'not_applicable';
  f.record.checks.persistence.reason = 'claimed read-only';
  f.record.checks.persistence.evidence = [f.addEvidence('Scope assessment', 'persistence_scope_assessment', 'reviewed_scope')];
  const errors = await f.check();
  assert.ok(errors.some(error => error.includes('有状态写入要求时必须执行')));
});

test('schemaVersion 3 permits reviewed persistence non-applicability for a read-only report', async () => {
  const f = v3Fixture({ surfaceType: 'report', target: 'supplier_performance_summary', stateEffect: 'read_only' });
  f.record.checks.persistence.scope = 'not_applicable';
  f.record.checks.persistence.reason = '报表只读，不产生业务或用户设置写入';
  f.record.checks.persistence.evidence = [f.addEvidence('No-write scope reviewed', 'persistence_scope_assessment', 'reviewed_scope', {
    actor: 'reviewer-02', role: 'independent_reviewer',
  })];
  assert.deepEqual(await f.check(), []);
});

test('schemaVersion 3 rejects missing role and performance proof', async () => {
  const f = v3Fixture();
  f.record.checks.permissions.roles.pop();
  f.record.checks.performance.metrics = f.record.checks.performance.metrics.filter(metric => metric.name !== 'refreshMs');
  f.record.requirements[0].subjectFiles = ['apps/forge-objectstack/src/pages/unrelated.page.ts'];
  const errors = await f.check();
  for (const token of ['两个真实角色', 'refreshMs', '实现文件超出受验范围']) assert.ok(errors.some(error => error.includes(token)), token);
});

test('schemaVersion 3 rejects requirements omitted from the manifest coverage set', async () => {
  const f = v3Fixture();
  f.entry.requirementIds.push('REQ-002');
  const errors = await f.check();
  assert.ok(errors.some(error => error.includes('requirements 编号集合与 manifest requirementIds 不一致')));
});

test('schemaVersion 3 requires configuration consumers to prove actual business effect', async () => {
  const f = v3Fixture({ stateEffect: 'changes_configuration' });
  let errors = await f.check();
  assert.ok(errors.some(error => error.includes('缺少 settingsConsumers 的实际业务消费者')));

  f.record.settingsConsumers = [{
    requirementId: 'REQ-001', settingId: 'warehouse.default-bin', consumerTarget: 'goods_receipt.post',
    expectedEffect: '新收货单采用配置的默认货位', actualEffect: '新收货单采用配置的默认货位', status: 'pass',
    evidence: [f.record.checks.persistence.evidence[0]],
  }];
  errors = await f.check();
  assert.ok(errors.some(error => error.includes('缺少要求的证据类型 business_result_readback')));

  f.record.settingsConsumers[0].evidence = [f.addEvidence(
    'Configured bin used by a new receipt', 'business_result_readback', 'independent_forge_readback',
  )];
  assert.deepEqual(await f.check(), []);
});

test('accepted cannot be obtained by filling only evidence path', async () => {
  const f = fixture();
  delete f.entry.acceptance;
  delete f.entry.contract;
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('逐页合同')));
  assert.ok(errors.some(x => x.includes('结构化验收记录')));
});

test('rejects missing or empty evidence and repository traversal', async () => {
  const f = fixture();
  f.files.set('docs/report.md', Buffer.from(''));
  f.entry.contract = '../outside.md';
  f.record.checks.visual.evidence = ['docs/missing.png'];
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('逐页合同')));
  assert.ok(errors.some(x => x.includes('docs/report.md')));
  assert.ok(errors.some(x => x.includes('docs/missing.png')));
});

test('rejects stale current source, wrong revision and missing shared baseline', async () => {
  const f = fixture();
  f.files.set('apps/forge-objectstack/src/pages/example.page.ts', Buffer.from('changed'));
  f.historical.set('apps/forge-objectstack/src/pages/product-ui.ts', Buffer.from('old'));
  delete f.record.subjectFiles['docs/forge-page-polish-baseline.md'];
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('旧验收失效')));
  assert.ok(errors.some(x => x.includes('与被验收版本不匹配')));
  assert.ok(errors.some(x => x.includes('缺少版本绑定文件')));
});

test('partial proof cannot be accepted, but can be retained under review_required', async () => {
  const f = fixture();
  f.record.checks.replication = { status: 'blocked', notes: 'No source data', evidence: [] };
  assert.ok((await f.check()).some(x => x.includes('accepted 必须全部通过')));
  f.entry.designStatus = 'review_required';
  delete f.entry.evidence;
  assert.deepEqual(await f.check(), []);
});

test('accepted rejects legacy records and pixel comparisons above the hard threshold', async () => {
  const f = fixture();
  f.record.schemaVersion = 1;
  f.record.pixelComparisons[0].mismatchedPixelRatio = 0.006;
  f.record.pixelComparisons[1].maxGeometryDeltaPx = 3;
  const errors = await f.check();
  for (const token of ['schemaVersion', '0.005', '2px']) assert.ok(errors.some(x => x.includes(token)), token);
});

test('accepted requires both same-viewport pixel comparisons and source, target, diff evidence', async () => {
  const f = fixture();
  f.record.pixelComparisons = [f.record.pixelComparisons[0]];
  f.record.pixelComparisons[0].viewport.width = 1280;
  f.record.pixelComparisons[0].diff = [];
  const errors = await f.check();
  for (const token of ['记录一致的视口', '像素差异图', 'narrow']) assert.ok(errors.some(x => x.includes(token)), token);
});

test('accepted recomputes the pixel ratio and rejects a forged diff image', async () => {
  const f = fixture();
  const changed = solidPng(1440, 900);
  changed.data.fill(0, 4 * 1440 * 100, 4 * 1440 * 120);
  f.files.set('evidence/desktop-forge.png', PNG.sync.write(changed));
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('与实测')));
  assert.ok(errors.some(x => x.includes('重新计算结果不一致')));
});

test('accepted recomputes major-element geometry instead of trusting the claimed delta', async () => {
  const f = fixture();
  const path = 'evidence/desktop-forge-geometry.json';
  const geometry = JSON.parse(f.files.get(path));
  geometry.elements[0].x += 3;
  f.files.set(path, Buffer.from(JSON.stringify(geometry)));
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('最大几何偏差') && x.includes('实测')));
});

test('accepted rejects dynamic exclusions that mask more than one percent of the business crop', async () => {
  const f = fixture();
  f.record.pixelComparisons[0].exclusions = [{ x: 0, y: 80, width: 1440, height: 20, reason: 'oversized mask' }];
  const errors = await f.check();
  assert.ok(errors.some(x => x.includes('排除面积比例') && x.includes('0.01')));
});

test('rejects wrong page, viewport, missing state evidence and self review', async () => {
  const f = fixture();
  f.record.pageId = 'page_other';
  f.record.visualEvidence.narrow.width = 1440;
  f.record.visualEvidence.empty = [];
  f.record.review.reviewer = 'builder';
  f.record.requirements[0].observed = '';
  const errors = await f.check();
  for (const token of ['pageId', '视口', 'empty', '独立复核', 'observed']) assert.ok(errors.some(x => x.includes(token)), token);
});

test('malformed records fail with findings instead of crashing', async () => {
  for (const payload of ['null', '[]', '{bad']) {
    const f = fixture();
    const original = f.io.read;
    f.io.read = name => name === 'docs/record.json' ? Buffer.from(payload) : original(name);
    assert.ok((await f.check()).length > 0);
  }
});

test('unresolvable review commit is rejected', async () => {
  const f = fixture();
  f.record.reviewedRevision = 'b'.repeat(40);
  assert.ok((await f.check()).some(x => x.includes('无法读取被验收提交')));
});

test('real repository reader resolves the worktree root and historical source', async () => {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim();
  const source = 'apps/forge-objectstack/src/pages/project-timesheet-cost.page.ts';
  assert.deepEqual(await repositoryIO.read(source), await repositoryIO.atRevision(revision, source));
  await assert.rejects(repositoryIO.read('../outside.md'));
  await assert.rejects(repositoryIO.read('/etc/hosts'));
  await assert.rejects(repositoryIO.read('docs/no-such-acceptance-evidence.json'));
});
