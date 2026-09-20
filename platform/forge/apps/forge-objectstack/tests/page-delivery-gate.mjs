import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const text = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repoPath = value => text(value) && !path.isAbsolute(value)
  && !value.split(/[\\/]/).some(part => part === '..' || part === '.' || part === '')
  && !value.includes('\\') && !value.includes(':');

// The injectable IO keeps negative cases independent of the working tree.
export const repositoryIO = {
  async read(file) {
    if (!repoPath(file)) throw new Error('必须使用仓库内相对文件路径');
    const resolved = await realpath(path.resolve(root, file));
    const actualRoot = await realpath(root);
    if (!resolved.startsWith(actualRoot + path.sep)) throw new Error('文件不能指向仓库外');
    return readFile(resolved);
  },
  async atRevision(revision, file) {
    return execFileSync('git', ['show', `${revision}:${file}`], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024,
    });
  },
};

export async function checkPageDelivery(entry, io = repositoryIO) {
  const errors = [];
  const accepted = entry.designStatus === 'accepted';
  const fail = message => errors.push(message);
  async function file(location, label) {
    if (!repoPath(location)) { fail(`${label}: 缺少仓库内相对文件路径`); return null; }
    try {
      const bytes = await io.read(location);
      if (!bytes.length || !bytes.toString().trim()) throw new Error('文件为空');
      return bytes;
    } catch { fail(`${label}: 文件不存在、为空或不在仓库内 (${location})`); return null; }
  }
  async function evidence(value, label) {
    if (!Array.isArray(value) || !value.length) { fail(`${label}: 缺少证据文件`); return; }
    for (const item of value) await file(item, label);
  }
  if (accepted || entry.contract !== undefined) await file(entry.contract, '逐页合同');
  if (accepted) await file(entry.evidence, '总体验收报告');
  if (!accepted && entry.acceptance === undefined) return errors;
  const bytes = await file(entry.acceptance, '结构化验收记录');
  if (!bytes) return errors;
  let record;
  try { record = JSON.parse(bytes.toString()); } catch { fail('验收记录不是有效 JSON'); return errors; }
  if (!plain(record)) { fail('验收记录必须为对象'); return errors; }
  if (record.schemaVersion !== 1) fail('验收记录 schemaVersion 必须为 1');
  if (entry.pages?.length !== 1 || record.pageId !== entry.pages[0]) fail('验收记录必须逐页对应 manifest pageId');
  if (record.archetype !== entry.archetype) fail('验收记录主原型与 manifest 不一致');
  const dimensions = ['replication', 'visual', 'interaction', 'business'];
  for (const dimension of dimensions) {
    const check = record.checks?.[dimension];
    if (!['pending', 'pass', 'blocked', 'fail'].includes(check?.status)) fail(`${dimension}: 缺少有效分项状态`);
    if (accepted || check?.status === 'pass') {
      if (check?.status !== 'pass') fail(`${dimension}: accepted 必须全部通过`);
      if (!text(check?.notes)) fail(`${dimension}: 缺少实际验收结论`);
      await evidence(check?.evidence, dimension);
    }
  }
  // Partial records deliberately retain pending dimensions without claiming acceptance.
  if (!accepted) return errors;
  const revisionValid = typeof record.reviewedRevision === 'string' && /^[a-f0-9]{40}$/.test(record.reviewedRevision);
  if (!revisionValid) fail('缺少真实 40 位被验收提交号');
  const subjectFiles = plain(record.subjectFiles) ? record.subjectFiles : {};
  for (const required of [
    `apps/forge-objectstack/src/pages/${entry.file}`,
    'apps/forge-objectstack/src/pages/product-ui.ts',
    `apps/forge-objectstack/src/pages/${entry.reference}`,
    'docs/forge-page-polish-baseline.md',
  ]) if (!(required in subjectFiles)) fail(`缺少版本绑定文件: ${required}`);
  for (const [name, digest] of Object.entries(subjectFiles)) {
    const current = await file(name, '受验文件');
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) { fail(`${name}: 缺少有效 SHA-256`); continue; }
    if (current && hash(current) !== digest) fail(`${name}: 当前内容已变化，旧验收失效`);
    if (revisionValid && repoPath(name)) {
      try {
        const old = await io.atRevision(record.reviewedRevision, name);
        if (hash(old) !== digest) fail(`${name}: 与被验收版本不匹配`);
      } catch { fail(`${name}: 无法读取被验收提交中的文件`); }
    }
  }
  for (const field of ['forgeUrl', 'database', 'materials']) {
    if (!text(record.environment?.[field])) fail(`缺少实际验收环境: ${field}`);
  }
  for (const kind of ['desktop', 'narrow']) {
    const viewport = record.visualEvidence?.[kind];
    if (!Number.isInteger(viewport?.width) || !Number.isInteger(viewport?.height)
      || viewport.height <= 0 || (kind === 'desktop' ? viewport.width < 1280 : viewport.width <= 0 || viewport.width > 760)) {
      fail(`${kind}: 缺少有效视口尺寸（桌面至少1280，窄屏最多760）`);
    }
    await evidence(viewport?.evidence, `${kind} 视觉`);
  }
  for (const kind of ['reference', 'populated', 'empty', 'form', 'error']) {
    await evidence(record.visualEvidence?.[kind], `${kind} 页面状态`);
  }
  const requirements = record.requirements;
  if (!Array.isArray(requirements) || !requirements.length) fail('缺少逐要求的操作与结果记录');
  const ids = new Set();
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    if (!text(requirement?.id) || ids.has(requirement.id)) fail('要求编号缺失或重复');
    ids.add(requirement?.id);
    if (requirement?.status !== 'pass') fail(`${requirement?.id}: 仍有未通过要求`);
    for (const field of ['steps', 'expected', 'observed']) {
      if (!text(requirement?.[field])) fail(`${requirement?.id}: 缺少 ${field}`);
    }
    await evidence(requirement?.evidence, `${requirement?.id} 要求`);
  }
  const review = record.review;
  if (review?.status !== 'pass' || !text(review?.implementer) || !text(review?.reviewer)
    || review.implementer.trim() === review.reviewer.trim()) fail('缺少实施者之外的独立复核');
  if (!text(review?.reviewedAt) || Number.isNaN(Date.parse(review.reviewedAt))) fail('缺少有效复核日期');
  await evidence(review?.evidence, '独立复核');
  return errors;
}
