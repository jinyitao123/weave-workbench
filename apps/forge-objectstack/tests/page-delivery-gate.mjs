import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const text = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const PIXEL_THRESHOLD = 0.1;
const PIXEL_RATIO_LIMIT = 0.005;
const PIXEL_RATIO_EPSILON = 1e-8;
const PIXEL_EXCLUSION_RATIO_LIMIT = 0.01;
const V3_SURFACES = new Set(['object', 'dashboard', 'report', 'component', 'action', 'page']);
const V3_DIMENSIONS = ['requirements', 'visual', 'interaction', 'business', 'permissions', 'persistence', 'performance'];
const V3_STATUSES = new Set(['pending', 'pass', 'blocked', 'fail']);
const V3_REQUIREMENT_SOURCES = new Set(['user_goal', 'customer_rule', 'forge_decision', 'external_reference']);
const V3_STATE_EFFECTS = new Set(['read_only', 'writes_business_state', 'changes_configuration', 'changes_personal_state']);
const V3_EVIDENCE_KINDS = new Set([
  'business_result_readback', 'design_baseline', 'forge_screenshot', 'independent_review',
  'interaction_recording', 'manual_observation', 'performance_trace', 'permission_attempt',
  'persistence_scope_assessment', 'reference_capture', 'restart_readback',
]);
const V3_EVIDENCE_EXTENSIONS = {
  business_result_readback: new Set(['.json', '.png']),
  design_baseline: new Set(['.json', '.md', '.png']),
  forge_screenshot: new Set(['.png']),
  independent_review: new Set(['.json', '.md']),
  interaction_recording: new Set(['.json', '.mp4', '.webm']),
  manual_observation: new Set(['.json', '.md']),
  performance_trace: new Set(['.csv', '.json', '.txt']),
  permission_attempt: new Set(['.json', '.png']),
  persistence_scope_assessment: new Set(['.json', '.md']),
  reference_capture: new Set(['.json', '.md', '.png']),
  restart_readback: new Set(['.json', '.md', '.txt']),
};
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

async function checkLegacyPageDelivery(entry, io = repositoryIO) {
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
  async function pngEvidence(value, label) {
    if (!Array.isArray(value) || value.length !== 1) {
      fail(`${label}: accepted 必须且只能提供一张 PNG`);
      return null;
    }
    const location = value[0];
    if (!text(location) || !location.toLowerCase().endsWith('.png')) {
      fail(`${label}: 必须提供 PNG 文件`);
      return null;
    }
    const bytes = await file(location, label);
    if (!bytes) return null;
    try { return PNG.sync.read(bytes); }
    catch { fail(`${label}: 不是可解码的 PNG`); return null; }
  }
  async function jsonEvidence(value, label) {
    if (!Array.isArray(value) || value.length !== 1) {
      fail(`${label}: accepted 必须且只能提供一份 JSON`);
      return null;
    }
    const location = value[0];
    if (!text(location) || !location.toLowerCase().endsWith('.json')) {
      fail(`${label}: 必须提供 JSON 文件`);
      return null;
    }
    const bytes = await file(location, label);
    if (!bytes) return null;
    try {
      const value = JSON.parse(bytes.toString());
      if (!plain(value)) throw new Error('not object');
      return value;
    } catch { fail(`${label}: 不是有效 JSON 对象`); return null; }
  }
  if (accepted || entry.contract !== undefined) await file(entry.contract, '逐页合同');
  if (accepted) await file(entry.evidence, '总体验收报告');
  if (!accepted && entry.acceptance === undefined) return errors;
  const bytes = await file(entry.acceptance, '结构化验收记录');
  if (!bytes) return errors;
  let record;
  try { record = JSON.parse(bytes.toString()); } catch { fail('验收记录不是有效 JSON'); return errors; }
  if (!plain(record)) { fail('验收记录必须为对象'); return errors; }
  if (![1, 2].includes(record.schemaVersion)) fail('验收记录 schemaVersion 必须为 1 或 2');
  if (accepted && record.schemaVersion !== 2) fail('像素级 accepted 验收记录 schemaVersion 必须为 2');
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
  const comparisons = Array.isArray(record.pixelComparisons) ? record.pixelComparisons : [];
  for (const kind of ['desktop', 'narrow']) {
    const comparison = comparisons.find(item => item?.kind === kind);
    if (!comparison) { fail(`${kind}: 缺少同视口像素对照`); continue; }
    const visualViewport = record.visualEvidence?.[kind];
    const viewport = comparison.viewport;
    if (!Number.isInteger(viewport?.width) || !Number.isInteger(viewport?.height)
      || viewport.width !== visualViewport?.width || viewport.height !== visualViewport?.height
      || viewport.scale !== 1) fail(`${kind}: RISEMAP 与 Forge 必须使用记录一致的视口和 100% 缩放`);
    const crop = comparison.crop;
    const cropValid = [crop?.x, crop?.y, crop?.width, crop?.height].every(Number.isInteger)
      && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
      && crop.x + crop.width <= viewport?.width && crop.y + crop.height <= viewport?.height
      && text(crop?.reason);
    if (!cropValid) fail(`${kind}: 缺少有效业务内容裁剪框及理由`);
    const referencePng = await pngEvidence(comparison.risemap, `${kind} RISEMAP 原图`);
    const forgePng = await pngEvidence(comparison.forge, `${kind} Forge 原图`);
    const suppliedDiffPng = await pngEvidence(comparison.diff, `${kind} 像素差异图`);
    const referenceGeometry = await jsonEvidence(comparison.geometry?.risemap, `${kind} RISEMAP 几何测量`);
    const forgeGeometry = await jsonEvidence(comparison.geometry?.forge, `${kind} Forge 几何测量`);
    if (comparison.tool !== 'pixelmatch 7.2.0') fail(`${kind}: 像素对照工具必须为 pixelmatch 7.2.0`);
    if (typeof comparison.mismatchedPixelRatio !== 'number'
      || comparison.mismatchedPixelRatio < 0 || comparison.mismatchedPixelRatio > PIXEL_RATIO_LIMIT) {
      fail(`${kind}: 不同像素比例必须不高于 ${PIXEL_RATIO_LIMIT}`);
    }
    if (typeof comparison.maxGeometryDeltaPx !== 'number'
      || comparison.maxGeometryDeltaPx < 0 || comparison.maxGeometryDeltaPx > 2) {
      fail(`${kind}: 主要元素最大几何偏差必须不高于 2px`);
    }
    if (!Array.isArray(comparison.exclusions)) fail(`${kind}: exclusions 必须显式记录为数组`);
    if (Array.isArray(comparison.exclusions) && comparison.exclusions.length > 10) fail(`${kind}: 动态像素排除区不得超过 10 个`);
    for (const exclusion of Array.isArray(comparison.exclusions) ? comparison.exclusions : []) {
      if (![exclusion?.x, exclusion?.y, exclusion?.width, exclusion?.height].every(Number.isInteger)
        || exclusion.x < crop?.x || exclusion.y < crop?.y
        || exclusion.width <= 0 || exclusion.height <= 0
        || exclusion.x + exclusion.width > crop?.x + crop?.width
        || exclusion.y + exclusion.height > crop?.y + crop?.height
        || !text(exclusion?.reason)) {
        fail(`${kind}: 动态像素排除区缺少坐标或理由`);
      }
    }
    if (referenceGeometry && forgeGeometry && cropValid) {
      const sameBox = (actual, expected) => ['x', 'y', 'width', 'height'].every(key => actual?.[key] === expected?.[key]);
      const sameViewport = actual => actual?.width === viewport?.width && actual?.height === viewport?.height && actual?.scale === 1;
      if (!sameViewport(referenceGeometry.viewport) || !sameViewport(forgeGeometry.viewport)) {
        fail(`${kind}: 几何测量视口与像素对照视口不一致`);
      }
      if (!sameBox(referenceGeometry.crop, crop) || !sameBox(forgeGeometry.crop, crop)) {
        fail(`${kind}: 几何测量裁剪框与像素对照裁剪框不一致`);
      }
      const validateElements = (geometry, label) => {
        const elements = geometry?.elements;
        if (!Array.isArray(elements) || elements.length < 5) {
          fail(`${kind} ${label}: 至少测量 5 个主要元素`);
          return new Map();
        }
        const result = new Map();
        for (const element of elements) {
          const valid = text(element?.id) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(element?.[key]))
            && element.x >= 0 && element.y >= 0 && element.width > 0 && element.height > 0
            && element.x + element.width <= crop.width && element.y + element.height <= crop.height;
          if (!valid || result.has(element?.id)) fail(`${kind} ${label}: 元素 id 或边界框无效`);
          else result.set(element.id, element);
        }
        return result;
      };
      const referenceElements = validateElements(referenceGeometry, 'RISEMAP 几何测量');
      const forgeElements = validateElements(forgeGeometry, 'Forge 几何测量');
      const referenceIds = [...referenceElements.keys()].sort();
      const forgeIds = [...forgeElements.keys()].sort();
      if (JSON.stringify(referenceIds) !== JSON.stringify(forgeIds)) {
        fail(`${kind}: RISEMAP 与 Forge 几何测量元素集合不一致`);
      } else if (referenceIds.length) {
        let measuredGeometryDelta = 0;
        for (const id of referenceIds) for (const key of ['x', 'y', 'width', 'height']) {
          measuredGeometryDelta = Math.max(measuredGeometryDelta, Math.abs(referenceElements.get(id)[key] - forgeElements.get(id)[key]));
        }
        if (Math.abs(measuredGeometryDelta - comparison.maxGeometryDeltaPx) > PIXEL_RATIO_EPSILON) {
          fail(`${kind}: 记录的最大几何偏差 ${comparison.maxGeometryDeltaPx}px 与实测 ${measuredGeometryDelta}px 不一致`);
        }
        if (measuredGeometryDelta > 2) fail(`${kind}: 实测主要元素最大几何偏差 ${measuredGeometryDelta}px 高于 2px`);
      }
    }
    if (referencePng && forgePng && suppliedDiffPng
      && Number.isInteger(crop?.x) && Number.isInteger(crop?.y)
      && Number.isInteger(crop?.width) && Number.isInteger(crop?.height)
      && crop.width > 0 && crop.height > 0) {
      for (const [label, image] of [['RISEMAP 原图', referencePng], ['Forge 原图', forgePng]]) {
        if (image.width !== viewport?.width || image.height !== viewport?.height) {
          fail(`${kind} ${label}: PNG 尺寸 ${image.width}x${image.height} 与记录视口不一致`);
        }
      }
      if (suppliedDiffPng.width !== crop.width || suppliedDiffPng.height !== crop.height) {
        fail(`${kind} 像素差异图: PNG 必须是裁剪后的 ${crop.width}x${crop.height}`);
      }
      const dimensionsMatch = referencePng.width === viewport?.width && referencePng.height === viewport?.height
        && forgePng.width === viewport?.width && forgePng.height === viewport?.height
        && suppliedDiffPng.width === crop.width && suppliedDiffPng.height === crop.height;
      if (dimensionsMatch) {
        const referenceCrop = Buffer.alloc(crop.width * crop.height * 4);
        const forgeCrop = Buffer.alloc(crop.width * crop.height * 4);
        let excludedPixels = 0;
        const exclusions = Array.isArray(comparison.exclusions) ? comparison.exclusions : [];
        for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
          const sourceOffset = ((crop.y + y) * viewport.width + crop.x + x) * 4;
          const targetOffset = (y * crop.width + x) * 4;
          referencePng.data.copy(referenceCrop, targetOffset, sourceOffset, sourceOffset + 4);
          forgePng.data.copy(forgeCrop, targetOffset, sourceOffset, sourceOffset + 4);
          if (exclusions.some(area => crop.x + x >= area.x && crop.x + x < area.x + area.width
            && crop.y + y >= area.y && crop.y + y < area.y + area.height)) {
            referenceCrop.copy(forgeCrop, targetOffset, targetOffset, targetOffset + 4);
            excludedPixels++;
          }
        }
        const generatedDiff = Buffer.alloc(crop.width * crop.height * 4);
        const mismatchedPixels = pixelmatch(referenceCrop, forgeCrop, generatedDiff, crop.width, crop.height, {
          threshold: PIXEL_THRESHOLD,
        });
        const comparedPixels = crop.width * crop.height - excludedPixels;
        const excludedRatio = excludedPixels / (crop.width * crop.height);
        if (excludedRatio > PIXEL_EXCLUSION_RATIO_LIMIT) {
          fail(`${kind}: 动态像素排除面积比例 ${excludedRatio} 高于 ${PIXEL_EXCLUSION_RATIO_LIMIT}`);
        }
        const measuredRatio = comparedPixels > 0 ? mismatchedPixels / comparedPixels : 0;
        if (Math.abs(measuredRatio - comparison.mismatchedPixelRatio) > PIXEL_RATIO_EPSILON) {
          fail(`${kind}: 记录的不同像素比例 ${comparison.mismatchedPixelRatio} 与实测 ${measuredRatio} 不一致`);
        }
        if (measuredRatio > PIXEL_RATIO_LIMIT) {
          fail(`${kind}: 实测不同像素比例 ${measuredRatio} 高于 ${PIXEL_RATIO_LIMIT}`);
        }
        if (!generatedDiff.equals(suppliedDiffPng.data)) {
          fail(`${kind}: 提交的像素差异图与门禁重新计算结果不一致`);
        }
      }
    }
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

async function checkPageDeliveryV3(entry, io, record) {
  const errors = [];
  const accepted = entry.designStatus === 'accepted';
  const fail = message => errors.push(message);
  const requiredText = (value, label) => {
    if (!text(value)) fail(`${label}: 缺少有效文本`);
  };
  async function file(location, label) {
    if (!repoPath(location)) { fail(`${label}: 必须使用仓库内相对文件路径`); return null; }
    try {
      const bytes = await io.read(location);
      if (!bytes.length || !bytes.toString().trim()) throw new Error('文件为空');
      return bytes;
    } catch { fail(`${label}: 文件不存在、为空或不在仓库内 (${location})`); return null; }
  }
  function verifyEvidenceArtifact(item, bytes, label) {
    const extension = path.extname(item.path).toLowerCase();
    if (!V3_EVIDENCE_EXTENSIONS[item.kind]?.has(extension)) {
      fail(`${label}: ${item.kind} 不支持证据文件类型 ${extension || '(无扩展名)'}`);
      return;
    }
    if (extension === '.png') {
      try {
        const image = PNG.sync.read(bytes);
        if (item.viewport && (image.width !== item.viewport.width || image.height !== item.viewport.height)) {
          fail(`${label}: PNG 实际尺寸与记录视口不一致`);
        }
      } catch { fail(`${label}: 不是可解码的 PNG 图像`); }
    } else if (extension === '.json') {
      try {
        const artifact = JSON.parse(bytes.toString());
        if (!plain(artifact)) throw new Error('not object');
        for (const field of ['featureId', 'target', 'materialId', 'revision', 'actor', 'claim', 'method', 'role', 'decision', 'database', 'databaseType']) {
          if (item[field] === undefined) continue;
          if (artifact[field] !== item[field]) fail(`${label}: JSON 证据 ${field} 与证据登记不一致`);
        }
      } catch { fail(`${label}: 不是有效的结构化 JSON 证据`); }
    }
  }
  const checkedFiles = new Map();
  const featureId = record.featureId;
  const target = record.target;
  const reviewedRevision = record.reviewedRevision;
  const validRevision = typeof reviewedRevision === 'string' && /^[a-f0-9]{40}$/.test(reviewedRevision);
  const knownMaterials = new Set(Array.isArray(record.environment?.materials)
    ? record.environment.materials.filter(plain).map(item => item.id).filter(text)
    : []);

  if (!['accepted', 'review_required'].includes(entry.designStatus)) fail('manifest designStatus 必须为 accepted 或 review_required');
  if (!accepted && entry.evidence) fail('review_required manifest 不得附带总体成功报告或已验收证据');
  if (!accepted && record.review?.decision === 'accepted') fail('review_required manifest 与结构化 accepted 决议冲突');
  if (record.schemaVersion !== 3) fail('验收记录 schemaVersion 必须为 3');
  if (accepted && record.schemaVersion !== 3) fail('新准则 accepted 必须使用 schemaVersion 3');
  if (!V3_SURFACES.has(record.surfaceType)) fail('surfaceType 必须为 object/dashboard/report/component/action/page');
  requiredText(featureId, 'featureId');
  requiredText(record.app, 'app');
  requiredText(target, 'target');
  if (record.surfaceType === 'page') {
    requiredText(record.pageId, '自定义 Page 的 pageId');
    if (text(record.pageId) && text(target) && record.pageId !== target) fail('pageId 必须与 page target 一致');
  } else if (record.pageId !== undefined) {
    fail('只有 surfaceType=page 才能记录 pageId');
  }
  if (accepted) {
    for (const field of ['featureId', 'app', 'surfaceType', 'target']) {
      if (!text(entry[field])) fail(`manifest 缺少 v3 ${field} 绑定`);
      else if (record[field] !== entry[field]) fail(`验收记录 ${field} 与 manifest 不一致`);
    }
    if (!Array.isArray(entry.requirementIds) || !entry.requirementIds.length
      || entry.requirementIds.some(id => !text(id)) || new Set(entry.requirementIds).size !== entry.requirementIds.length) {
      fail('manifest 缺少唯一且完整的 requirementIds');
    }
  } else {
    for (const field of ['featureId', 'app', 'surfaceType', 'target']) {
      if (entry[field] !== undefined && record[field] !== entry[field]) fail(`验收记录 ${field} 与 manifest 不一致`);
    }
  }

  if (!validRevision) {
    if (accepted || (reviewedRevision !== undefined && text(reviewedRevision))) fail('缺少真实 40 位被验收提交号');
  }
  const subjectFiles = plain(record.subjectFiles) ? record.subjectFiles : {};
  const subjectPaths = Object.keys(subjectFiles);
  if (accepted && subjectPaths.length === 0) fail('accepted 缺少受验文件及 SHA-256');
  if (!plain(record.subjectFiles)) {
    if (accepted || record.subjectFiles !== undefined) fail('subjectFiles 必须为路径到 SHA-256 的对象');
  }
  if (accepted) {
    const manifestFiles = entry.subjectFiles;
    if (!Array.isArray(manifestFiles) || !manifestFiles.length) {
      fail('manifest 缺少受验 subjectFiles 范围');
    } else {
      if (manifestFiles.some(filePath => !repoPath(filePath))) fail('manifest subjectFiles 必须使用仓库内相对路径');
      if (new Set(manifestFiles).size !== manifestFiles.length) fail('manifest subjectFiles 含重复路径');
      const expected = [...manifestFiles].sort();
      const actual = [...subjectPaths].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('受验文件与 manifest 声明范围不一致');
    }
  } else if (entry.subjectFiles !== undefined && Array.isArray(entry.subjectFiles)) {
    const expected = [...entry.subjectFiles].sort();
    const actual = [...subjectPaths].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('受验文件与 manifest 声明范围不一致');
  }
  for (const [location, digest] of Object.entries(subjectFiles)) {
    if (!repoPath(location)) { fail(`受验文件必须位于仓库内 (${location})`); continue; }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      fail(`${location}: 缺少有效 SHA-256`);
      continue;
    }
    const current = await file(location, '受验文件');
    if (current) {
      checkedFiles.set(location, digest);
      if (hash(current) !== digest) fail(`${location}: 当前内容已变化，旧验收失效`);
    }
    if (validRevision) {
      try {
        const old = await io.atRevision(reviewedRevision, location);
        if (hash(old) !== digest) fail(`${location}: 与被验收版本不匹配`);
      } catch { fail(`${location}: 无法读取被验收提交中的文件`); }
    }
  }

  const environment = record.environment;
  if (accepted) {
    requiredText(environment?.forgeUrl, '验收环境 Forge URL');
    requiredText(environment?.databaseType, '验收环境 databaseType');
    requiredText(environment?.database, '验收环境 database');
    if (!Array.isArray(environment?.materials) || !environment.materials.length) fail('验收环境缺少实际材料');
    try {
      const url = new URL(environment.forgeUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) fail('验收环境 Forge URL 必须是实际 HTTP/HTTPS 地址');
    } catch { fail('验收环境 Forge URL 无效'); }
  }
  if (environment?.materials !== undefined) {
    if (!Array.isArray(environment.materials)) fail('environment.materials 必须为带 id 的数组');
    else for (const material of environment.materials) {
      if (!plain(material) || !text(material.id) || !text(material.name)) fail('每项验收材料必须记录 id 和 name');
    }
  }

  async function evidence(items, label, options = {}) {
    const { required = false, kinds = null, actor = null } = options;
    if (!Array.isArray(items) || (required && items.length === 0)) {
      if (required || items !== undefined) fail(`${label}: 缺少结构化证据`);
      return [];
    }
    const acceptedItems = [];
    for (const item of items) {
      if (!plain(item)) { fail(`${label}: 证据必须包含可核对的来源对象`); continue; }
      const evidencePath = item.path;
      const bytes = await file(evidencePath, `${label} 证据`);
      const fields = ['kind', 'claim', 'method', 'actor', 'role', 'materialId', 'capturedAt', 'revision', 'featureId', 'target'];
      for (const field of fields) requiredText(item[field], `${label} 证据 ${field}`);
      if (!V3_EVIDENCE_KINDS.has(item.kind)) fail(`${label}: evidence.kind 无效 (${item.kind})`);
      if (kinds && !kinds.includes(item.kind)) fail(`${label}: 缺少要求的证据类型 ${kinds.join('/')}`);
      if (actor && item.actor !== actor) fail(`${label}: 复核证据 actor 必须与 reviewer 一致`);
      if (item.featureId !== featureId) fail(`${label}: 证据 featureId 与验收记录不一致`);
      if (item.target !== target) fail(`${label}: 证据 target 与验收记录不一致`);
      if (validRevision && item.revision !== reviewedRevision) fail(`${label}: 证据版本与 reviewedRevision 不一致`);
      if (!knownMaterials.has(item.materialId)) fail(`${label}: 证据必须绑定 environment 中的实际材料`);
      if (typeof item.capturedAt !== 'string' || Number.isNaN(Date.parse(item.capturedAt))) fail(`${label}: capturedAt 必须是有效日期`);
      if (bytes) {
        verifyEvidenceArtifact(item, bytes, label);
        acceptedItems.push(item);
      }
    }
    return acceptedItems;
  }

  const baseline = record.designBaseline;
  if (accepted || baseline !== undefined) {
    requiredText(baseline?.revision, 'Forge designBaseline revision');
    await evidence(baseline?.evidence, 'Forge 设计基线', { required: accepted, kinds: ['design_baseline'] });
  }
  if (record.referenceEvidence !== undefined && !Array.isArray(record.referenceEvidence)) {
    fail('referenceEvidence 必须为数组，外部参考可以为空');
  }
  const referenceIds = new Set();
  for (const reference of Array.isArray(record.referenceEvidence) ? record.referenceEvidence : []) {
    if (!plain(reference) || !text(reference.id) || referenceIds.has(reference.id)) fail('referenceEvidence id 缺失或重复');
    else referenceIds.add(reference.id);
    requiredText(reference?.source, 'referenceEvidence source');
    requiredText(reference?.limitations, 'referenceEvidence limitations');
    await evidence(reference?.evidence, '外部参考', { required: accepted, kinds: ['reference_capture'] });
  }

  if (record.checks !== undefined && !plain(record.checks)) fail('checks 必须为对象');
  if (record.requirements !== undefined && !Array.isArray(record.requirements)) fail('requirements 必须为数组');
  if (record.settingsConsumers !== undefined && !Array.isArray(record.settingsConsumers)) fail('settingsConsumers 必须为数组');
  const checks = plain(record.checks) ? record.checks : {};
  for (const dimension of V3_DIMENSIONS) {
    const check = checks[dimension];
    if (!V3_STATUSES.has(check?.status)) {
      if (accepted || check !== undefined) fail(`${dimension}: 缺少有效分项状态`);
      continue;
    }
    if (accepted && check.status !== 'pass') fail(`${dimension}: accepted 必须全部通过`);
    if ((accepted || check.status === 'pass') && !text(check.notes)) fail(`${dimension}: 缺少实际验收结论`);
    await evidence(check.evidence, dimension, { required: accepted || check.status === 'pass' });
  }

  const requirements = Array.isArray(record.requirements) ? record.requirements : [];
  if (accepted && requirements.length === 0) fail('缺少逐要求的操作与结果记录');
  const requirementIds = new Set();
  const mutatingRequirements = [];
  for (const requirement of requirements) {
    if (!plain(requirement)) { fail('requirements 项必须为对象'); continue; }
    if (!text(requirement.id) || requirementIds.has(requirement.id)) fail('要求编号缺失或重复');
    requirementIds.add(requirement.id);
    if (!V3_REQUIREMENT_SOURCES.has(requirement.source?.type)) fail(`${requirement.id}: 缺少有效需求来源`);
    if (requirement.source?.type !== 'external_reference') requiredText(requirement.source?.reference, `${requirement.id}: source reference`);
    if (requirement.source?.type === 'external_reference'
      && (!text(requirement.source.referenceId) || !referenceIds.has(requirement.source.referenceId))) {
      fail(`${requirement.id}: external_reference 必须关联 referenceEvidence`);
    }
    requiredText(requirement.statement, `${requirement.id}: statement`);
    if (accepted && requirement.status !== 'pass') fail(`${requirement.id}: accepted 仍有未通过要求`);
    else if (requirement.status !== undefined && !V3_STATUSES.has(requirement.status)) fail(`${requirement.id}: status 无效`);
    if (accepted || requirement.status === 'pass') {
      for (const field of ['expected', 'actual']) requiredText(requirement[field], `${requirement.id}: ${field}`);
      if (!Array.isArray(requirement.steps) || !requirement.steps.length || requirement.steps.some(step => !text(step))) {
        fail(`${requirement.id}: 缺少实际操作步骤`);
      }
      if (!Array.isArray(requirement.subjectFiles) || !requirement.subjectFiles.length) {
        fail(`${requirement.id}: 缺少实现文件绑定`);
      } else for (const location of requirement.subjectFiles) {
        if (!checkedFiles.has(location)) fail(`${requirement.id}: 实现文件超出受验范围 (${location})`);
      }
      if (!V3_STATE_EFFECTS.has(requirement.stateEffect)) fail(`${requirement.id}: 缺少 stateEffect`);
      else if (requirement.stateEffect !== 'read_only') mutatingRequirements.push(requirement);
    }
    await evidence(requirement.evidence, `${requirement.id} 要求`, { required: accepted || requirement.status === 'pass' });
  }
  if (accepted && Array.isArray(entry.requirementIds)) {
    const expected = [...entry.requirementIds].sort();
    const actual = [...requirementIds].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('requirements 编号集合与 manifest requirementIds 不一致');
  }

  const configurationRequirements = requirements.filter(requirement => requirement?.stateEffect === 'changes_configuration');
  if (accepted && configurationRequirements.length) {
    if (!Array.isArray(record.settingsConsumers) || record.settingsConsumers.length === 0) {
      fail('configuration 要求缺少 settingsConsumers 的实际业务消费者');
    } else {
      const coveredRequirements = new Set();
      for (const consumer of record.settingsConsumers) {
        if (!plain(consumer)) { fail('settingsConsumers 项必须为对象'); continue; }
        for (const field of ['requirementId', 'settingId', 'consumerTarget', 'expectedEffect', 'actualEffect']) {
          requiredText(consumer[field], `settingsConsumers.${field}`);
        }
        if (!configurationRequirements.some(requirement => requirement.id === consumer.requirementId)) {
          fail('settingsConsumers 必须关联 changes_configuration 要求');
        }
        if (consumer.status !== 'pass') fail(`settingsConsumers ${consumer.settingId || ''}: 实际业务生效未通过`);
        const items = await evidence(consumer.evidence, `settingsConsumers.${consumer.settingId || 'setting'}`, {
          required: true, kinds: ['business_result_readback'],
        });
        if (!items.some(item => item.method === 'independent_forge_readback' && item.actor !== record.review?.implementer)) {
          fail(`settingsConsumers ${consumer.settingId || ''}: 缺少独立业务效果回读`);
        }
        if (text(consumer.requirementId)) coveredRequirements.add(consumer.requirementId);
      }
      for (const requirement of configurationRequirements) {
        if (!coveredRequirements.has(requirement.id)) fail(`${requirement.id}: 缺少对应的 settingsConsumers 实际业务效果`);
      }
    }
  }

  const checkEvidence = dimension => Array.isArray(checks[dimension]?.evidence) ? checks[dimension].evidence : [];
  if (accepted) {
    const visualItems = await evidence(checkEvidence('visual'), 'visual', { required: true, kinds: ['forge_screenshot'] });
    for (const viewportClass of ['desktop', 'narrow']) {
      const matches = visualItems.filter(item => item.kind === 'forge_screenshot' && item.viewport?.class === viewportClass);
      if (!matches.length) fail(`visual: 缺少 Forge ${viewportClass} 视口截图`);
      for (const item of matches) {
        const viewport = item.viewport;
        if (!Number.isInteger(viewport?.width) || !Number.isInteger(viewport?.height) || viewport.height <= 0
          || (viewportClass === 'desktop' ? viewport.width < 1280 : viewport.width <= 0 || viewport.width > 760)) {
          fail(`visual: ${viewportClass} 截图缺少有效视口尺寸`);
        }
      }
    }
    const interactionItems = checkEvidence('interaction');
    if (!interactionItems.some(item => item?.kind === 'interaction_recording' && item.method === 'live_forge_ui')) {
      fail('interaction: accepted 必须包含 Forge 正常路径的真实交互记录');
    }
    const businessItems = checkEvidence('business');
    if (!businessItems.some(item => item?.kind === 'business_result_readback'
      && item.method === 'independent_forge_readback' && item.actor !== record.review?.implementer)) {
      fail('business: accepted 必须包含独立 Forge 业务结果回读');
    }
  }

  const permissionCheck = checks.permissions;
  if (accepted || permissionCheck?.roles !== undefined) {
    const observations = permissionCheck?.roles;
    if (!Array.isArray(observations) || observations.length < 2) {
      fail('permissions: 至少需要两个真实角色的权限观察');
    } else {
      const principals = new Set();
      const outcomes = new Set();
      for (const observation of observations) {
        if (!plain(observation)) { fail('permissions: 角色观察必须为对象'); continue; }
        for (const field of ['role', 'principal', 'action']) requiredText(observation[field], `permissions.${field}`);
        if (text(observation.principal)) principals.add(observation.principal);
        if (!['allowed', 'denied'].includes(observation.expected) || observation.actual !== observation.expected) {
          fail(`permissions: ${observation.role || '角色'} 的实际权限与预期不一致`);
        } else outcomes.add(observation.actual);
        if (accepted && observation.status !== 'pass') fail(`permissions: ${observation.role || '角色'} 缺少通过结论`);
        const items = await evidence(observation.evidence, `permissions.${observation.role || 'role'}`, {
          required: accepted, kinds: ['permission_attempt'],
        });
        for (const item of items) {
          if (text(observation.role) && item.role !== observation.role) fail('权限证据 role 与角色观察不一致');
          if (text(observation.principal) && item.actor !== observation.principal) fail('权限证据 actor 与实际角色账号不一致');
        }
      }
      if (principals.size < 2) fail('permissions: 至少需要两个不同的真实账号/主体');
      if (accepted && (!outcomes.has('allowed') || !outcomes.has('denied'))) fail('permissions: 必须证明允许与拒绝两种结果');
    }
  }

  const persistence = checks.persistence;
  if (accepted || persistence?.scope !== undefined) {
    const stateful = mutatingRequirements.length > 0;
    if (stateful && persistence?.scope !== 'required') fail('persistence: 有状态写入要求时必须执行同一数据库停服重启读回');
    if (!stateful && !['required', 'not_applicable'].includes(persistence?.scope)) fail('persistence: 必须说明验证范围');
    if (persistence?.scope === 'not_applicable') {
      requiredText(persistence.reason, 'persistence not_applicable reason');
      const items = await evidence(persistence.evidence, 'persistence 不适用复核', {
        required: accepted, kinds: ['persistence_scope_assessment'],
      });
      if (accepted && !items.some(item => item.actor === record.review?.reviewer)) {
        fail('persistence 不适用必须由独立复核者确认');
      }
    } else if (persistence?.scope === 'required') {
      const items = await evidence(persistence.evidence, 'persistence 重启读回', {
        required: accepted, kinds: ['restart_readback'],
      });
      if (accepted || stateful) {
        if (environment?.databaseType === 'none' || !text(environment?.database)) fail('persistence: 缺少实际持久数据库身份');
        if (!items.some(item => item.method === 'complete_stop_restart_readback'
          && item.database === environment?.database && item.databaseType === environment?.databaseType)) {
          fail('persistence: 必须证明同一持久数据库完整停服、重启并读回');
        }
      }
    } else if (accepted) {
      fail('persistence: accepted 必须明确验证持久化或经复核说明不适用');
    }
  }

  const performance = checks.performance;
  if (accepted || performance?.metrics !== undefined) {
    const metrics = performance?.metrics;
    const requiredMetrics = ['coldOpenMs', 'refreshMs', 'navigationMs', 'requestCount', 'transferBytes'];
    if (!Array.isArray(metrics)) fail('performance: 缺少固定版本和材料的指标记录');
    else {
      const byName = new Map();
      for (const metric of metrics) {
        if (!plain(metric) || !text(metric.name) || byName.has(metric.name)) { fail('performance: 指标名称缺失或重复'); continue; }
        byName.set(metric.name, metric);
        requiredText(metric.budgetSource, `${metric.name}: budgetSource`);
        if (!Number.isFinite(metric.value) || metric.value < 0 || !Number.isFinite(metric.budget) || metric.budget <= 0) {
          fail(`${metric.name}: value/budget 必须是有效非负数`);
        } else if (accepted && metric.value > metric.budget) fail(`${metric.name}: 实测值超过已声明预算`);
        if (accepted && metric.status !== 'pass') fail(`${metric.name}: 指标未通过预算`);
        const items = await evidence(metric.evidence, `${metric.name} 性能`, {
          required: accepted, kinds: ['performance_trace'],
        });
        if (accepted && !items.some(item => item.method === 'fixed_material_performance_run')) {
          fail(`${metric.name}: 缺少固定材料性能实测`);
        }
      }
      if (accepted) for (const name of requiredMetrics) if (!byName.has(name)) fail(`performance: 缺少必需指标 ${name}`);
    }
  }

  const review = record.review;
  if (accepted || review !== undefined) {
    requiredText(review?.implementer, 'review implementer');
    requiredText(review?.reviewer, 'review reviewer');
    if (accepted && review?.status !== 'pass') fail('缺少独立复核通过结论');
    if (!accepted && review?.status !== undefined && !V3_STATUSES.has(review.status)) fail('review status 无效');
    if (accepted && review?.decision !== 'accepted') fail('review decision 必须明确为 accepted');
    if (text(review?.implementer) && text(review?.reviewer)
      && review.implementer.trim() === review.reviewer.trim()) fail('缺少实施者之外的独立复核');
    if ((accepted || review?.reviewedAt !== undefined)
      && (!text(review?.reviewedAt) || Number.isNaN(Date.parse(review.reviewedAt)))) fail('缺少有效复核日期');
    if (accepted && review?.reviewedRevision !== reviewedRevision) fail('独立复核 reviewedRevision 与验收版本不一致');
    const reviewEvidence = await evidence(review?.evidence, '独立复核', {
      required: accepted, kinds: ['independent_review'], actor: review?.reviewer,
    });
    if (accepted && !reviewEvidence.some(item => item.decision === 'accepted')) fail('独立复核证据必须记录 accepted 决定');
    if (accepted && !reviewEvidence.some(item => Date.parse(item.capturedAt) <= Date.parse(review.reviewedAt))) {
      fail('独立复核证据采集时间不得晚于复核时间');
    }
  }

  return errors;
}

export async function checkPageDelivery(entry, io = repositoryIO) {
  if (entry.acceptance && repoPath(entry.acceptance)) {
    try {
      const bytes = await io.read(entry.acceptance);
      const record = JSON.parse(bytes.toString());
      if (plain(record) && record.schemaVersion === 3) return checkPageDeliveryV3(entry, io, record);
    } catch { /* The legacy validator reports malformed or missing records with its established messages. */ }
  }
  return checkLegacyPageDelivery(entry, io);
}
