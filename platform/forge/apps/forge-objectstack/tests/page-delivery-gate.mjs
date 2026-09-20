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
