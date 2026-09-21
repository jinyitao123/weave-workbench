import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { comparePagePixels } from './page-pixel-compare.mjs';

function image(width, height, changed = false) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  if (changed) png.data.fill(0, (10 * width + 10) * 4, (10 * width + 11) * 4);
  return PNG.sync.write(png);
}

function geometry(width, height) {
  return {
    viewport: { width, height, scale: 1 }, crop: { x: 0, y: 0, width, height },
    elements: [
      { id: 'title', x: 1, y: 1, width: 10, height: 4 },
      { id: 'toolbar', x: 1, y: 6, width: 20, height: 4 },
      { id: 'filters', x: 1, y: 11, width: 40, height: 5 },
      { id: 'table', x: 1, y: 17, width: 50, height: 20 },
      { id: 'pagination', x: 1, y: 38, width: 50, height: 4 }
    ]
  };
}

async function fixture(changed = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-pixel-'));
  const files = Object.fromEntries(['reference', 'forge', 'referenceGeometry', 'forgeGeometry', 'diff', 'report'].map(name => [name, path.join(dir, `${name}.${name.includes('Geometry') || name === 'report' ? 'json' : 'png'}`)]));
  await writeFile(files.reference, image(64, 48));
  await writeFile(files.forge, image(64, 48, changed));
  await writeFile(files.referenceGeometry, JSON.stringify(geometry(64, 48)));
  await writeFile(files.forgeGeometry, JSON.stringify(geometry(64, 48)));
  return { dir, files };
}

test('writes a reproducible PNG diff and measured report', async t => {
  const { dir, files } = await fixture(false); t.after(() => rm(dir, { recursive: true, force: true }));
  const report = await comparePagePixels({ reference: files.reference, forge: files.forge, diff: files.diff, report: files.report, crop: { x: 0, y: 0, width: 64, height: 48 }, exclusions: [], referenceGeometry: files.referenceGeometry, forgeGeometry: files.forgeGeometry });
  assert.equal(report.mismatchedPixelRatio, 0);
  assert.equal(report.maxGeometryDeltaPx, 0);
  assert.deepEqual(JSON.parse(await readFile(files.report)), report);
  assert.deepEqual([PNG.sync.read(await readFile(files.diff)).width, PNG.sync.read(await readFile(files.diff)).height], [64, 48]);
});

test('measures changed pixels and rejects oversized exclusions', async t => {
  const { dir, files } = await fixture(true); t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { reference: files.reference, forge: files.forge, diff: files.diff, report: files.report, crop: { x: 0, y: 0, width: 64, height: 48 }, exclusions: [], referenceGeometry: files.referenceGeometry, forgeGeometry: files.forgeGeometry };
  assert.ok((await comparePagePixels(options)).mismatchedPixelRatio > 0);
  await assert.rejects(comparePagePixels({ ...options, exclusions: [{ x: 0, y: 0, width: 64, height: 2, reason: 'too large' }] }), /排除面积比例/);
});

test('rejects JPEG content disguised with a PNG extension', async t => {
  const { dir, files } = await fixture(false); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(files.reference, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await assert.rejects(comparePagePixels({ reference: files.reference, forge: files.forge, crop: { x: 0, y: 0, width: 64, height: 48 }, exclusions: [] }), /真实 PNG/);
});
