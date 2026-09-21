import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const PIXEL_COMPARE_TOOL = 'pixelmatch 7.2.0';
export const PIXEL_COMPARE_THRESHOLD = 0.1;
export const PIXEL_EXCLUSION_RATIO_LIMIT = 0.01;

const boxKeys = ['x', 'y', 'width', 'height'];
const boxIsValid = (box, bounds) => boxKeys.every(key => Number.isInteger(box?.[key]))
  && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
  && box.x + box.width <= bounds.width && box.y + box.height <= bounds.height;

async function readPng(file, label) {
  try { return PNG.sync.read(await readFile(file)); }
  catch { throw new Error(`${label} 必须是可解码的真实 PNG: ${file}`); }
}

async function readJson(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`${label} 必须是有效 JSON: ${file}`); }
}

function geometryDelta(reference, forge, viewport, crop) {
  for (const [label, geometry] of [['RISEMAP', reference], ['Forge', forge]]) {
    if (geometry?.viewport?.width !== viewport.width || geometry?.viewport?.height !== viewport.height || geometry?.viewport?.scale !== 1) throw new Error(`${label} 几何视口与截图不一致`);
    if (!boxKeys.every(key => geometry?.crop?.[key] === crop[key])) throw new Error(`${label} 几何裁剪框与像素裁剪框不一致`);
    if (!Array.isArray(geometry.elements) || geometry.elements.length < 5) throw new Error(`${label} 几何测量至少包含 5 个主要元素`);
  }
  const map = (geometry, label) => {
    const result = new Map();
    for (const element of geometry.elements) {
      if (typeof element?.id !== 'string' || !element.id.trim() || result.has(element.id)
        || !boxKeys.every(key => Number.isFinite(element?.[key]))
        || element.x < 0 || element.y < 0 || element.width <= 0 || element.height <= 0
        || element.x + element.width > crop.width || element.y + element.height > crop.height) throw new Error(`${label} 几何元素无效或重复: ${element?.id || 'unknown'}`);
      result.set(element.id, element);
    }
    return result;
  };
  const left = map(reference, 'RISEMAP'), right = map(forge, 'Forge');
  const leftIds = [...left.keys()].sort(), rightIds = [...right.keys()].sort();
  if (JSON.stringify(leftIds) !== JSON.stringify(rightIds)) throw new Error('RISEMAP 与 Forge 几何元素集合不一致');
  let maximum = 0;
  for (const id of leftIds) for (const key of boxKeys) maximum = Math.max(maximum, Math.abs(left.get(id)[key] - right.get(id)[key]));
  return maximum;
}

export async function comparePagePixels(options) {
  const reference = await readPng(options.reference, 'RISEMAP 原图');
  const forge = await readPng(options.forge, 'Forge 原图');
  if (reference.width !== forge.width || reference.height !== forge.height) throw new Error(`双侧截图尺寸不一致: ${reference.width}x${reference.height} / ${forge.width}x${forge.height}`);
  const viewport = { width: reference.width, height: reference.height, scale: 1 };
  const crop = options.crop;
  if (!boxIsValid(crop, viewport)) throw new Error('业务内容裁剪框无效或超出视口');
  const exclusions = options.exclusions || [];
  if (!Array.isArray(exclusions) || exclusions.length > 10) throw new Error('动态排除区必须是最多 10 项的数组');
  for (const exclusion of exclusions) {
    if (!boxIsValid(exclusion, viewport) || exclusion.x < crop.x || exclusion.y < crop.y
      || exclusion.x + exclusion.width > crop.x + crop.width
      || exclusion.y + exclusion.height > crop.y + crop.height
      || typeof exclusion.reason !== 'string' || !exclusion.reason.trim()) throw new Error('动态排除区必须位于业务裁剪框内并说明原因');
  }
  const referenceCrop = Buffer.alloc(crop.width * crop.height * 4);
  const forgeCrop = Buffer.alloc(crop.width * crop.height * 4);
  let excludedPixels = 0;
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    const sourceOffset = ((crop.y + y) * viewport.width + crop.x + x) * 4;
    const targetOffset = (y * crop.width + x) * 4;
    reference.data.copy(referenceCrop, targetOffset, sourceOffset, sourceOffset + 4);
    forge.data.copy(forgeCrop, targetOffset, sourceOffset, sourceOffset + 4);
    if (exclusions.some(area => crop.x + x >= area.x && crop.x + x < area.x + area.width
      && crop.y + y >= area.y && crop.y + y < area.y + area.height)) {
      referenceCrop.copy(forgeCrop, targetOffset, targetOffset, targetOffset + 4);
      excludedPixels++;
    }
  }
  const excludedRatio = excludedPixels / (crop.width * crop.height);
  if (excludedRatio > PIXEL_EXCLUSION_RATIO_LIMIT) throw new Error(`动态排除面积比例 ${excludedRatio} 高于 ${PIXEL_EXCLUSION_RATIO_LIMIT}`);
  const diff = new PNG({ width: crop.width, height: crop.height });
  const mismatchedPixels = pixelmatch(referenceCrop, forgeCrop, diff.data, crop.width, crop.height, { threshold: PIXEL_COMPARE_THRESHOLD });
  const comparedPixels = crop.width * crop.height - excludedPixels;
  const mismatchedPixelRatio = comparedPixels > 0 ? mismatchedPixels / comparedPixels : 0;
  let maxGeometryDeltaPx = null;
  if (options.referenceGeometry || options.forgeGeometry) {
    if (!options.referenceGeometry || !options.forgeGeometry) throw new Error('双侧几何 JSON 必须同时提供');
    maxGeometryDeltaPx = geometryDelta(
      await readJson(options.referenceGeometry, 'RISEMAP 几何'),
      await readJson(options.forgeGeometry, 'Forge 几何'), viewport, crop,
    );
  }
  const report = {
    tool: PIXEL_COMPARE_TOOL,
    threshold: PIXEL_COMPARE_THRESHOLD,
    viewport,
    crop,
    exclusions,
    excludedPixelRatio: excludedRatio,
    comparedPixels,
    mismatchedPixels,
    mismatchedPixelRatio,
    maxGeometryDeltaPx,
  };
  if (options.diff) {
    await mkdir(path.dirname(options.diff), { recursive: true });
    await writeFile(options.diff, PNG.sync.write(diff));
  }
  if (options.report) {
    await mkdir(path.dirname(options.report), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] === undefined) throw new Error(`参数格式错误: ${key || ''}`);
    values[key.slice(2)] = argv[index + 1];
  }
  for (const required of ['reference', 'forge', 'diff', 'report', 'crop']) if (!values[required]) throw new Error(`缺少 --${required}`);
  const cropValues = values.crop.split(',').map(Number);
  if (cropValues.length !== 4 || cropValues.some(value => !Number.isInteger(value))) throw new Error('--crop 必须为 x,y,width,height');
  return {
    reference: values.reference,
    forge: values.forge,
    diff: values.diff,
    report: values.report,
    crop: Object.fromEntries(boxKeys.map((key, index) => [key, cropValues[index]])),
    exclusions: values.exclusions ? JSON.parse(values.exclusions) : [],
    referenceGeometry: values['reference-geometry'],
    forgeGeometry: values['forge-geometry'],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  comparePagePixels(parseArgs(process.argv.slice(2)))
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
