import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkPageDelivery, repositoryIO } from './page-delivery-gate.mjs';
import { execFileSync } from 'node:child_process';

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
  const record = {
    schemaVersion: 1, pageId: 'page_example', archetype: 'timesheet_composite',
    reviewedRevision: 'a'.repeat(40),
    subjectFiles: Object.fromEntries(sourcePaths.map(name => [name, createHash('sha256').update(files.get(name)).digest('hex')])),
    environment: { forgeUrl: 'http://localhost:4499', database: '.objectstack/example.sqlite', materials: 'CASE-001' },
    checks: Object.fromEntries(['replication', 'visual', 'interaction', 'business'].map(key => [key, { status: 'pass', notes: 'Observed result', evidence }])),
    visualEvidence: {
      desktop: { width: 1440, height: 900, evidence }, narrow: { width: 390, height: 844, evidence },
      reference: evidence, populated: evidence, empty: evidence, form: evidence, error: evidence,
    },
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

test('complete record passes; legacy review debt remains visibly unaccepted', async () => {
  const f = fixture();
  assert.deepEqual(await f.check(), []);
  assert.deepEqual(await checkPageDelivery({ designStatus: 'review_required' }, f.io), []);
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
