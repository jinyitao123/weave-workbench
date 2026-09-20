import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.objectstack'].includes(entry.name)) out.push(...await walk(path));
    } else if (/\.(page|action|object|config)\.ts$/.test(entry.name) || entry.name === 'objectstack.config.ts') {
      out.push(path);
    }
  }
  return out;
}

const srcDir = new URL('../src/', import.meta.url);
const files = await walk(srcDir.pathname);
const banned = [
  /RMTEST/,
  /售后对照组/,
  /后续切片/,
  /本阶段仅验证/,
  /复刻验收/,
  /待复核/,
  /当前库(?!存)/,
  /用于 Forge/,
  /Forge \//,
  /操作对象/,
];
const allow = [
  /客户物料对照/,
  /对照条数/,
  /page_project_plan_risemap/,
];
const findings = [];
for (const name of files) {
  const path = name;
  const relativeName = name.slice(srcDir.pathname.length);
  const lines = (await readFile(path, 'utf8')).split('\n');
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (allow.some(pattern => pattern.test(trimmed))) continue;
    const hit = banned.find(pattern => pattern.test(trimmed));
    if (hit) findings.push({ file: relativeName, line: index + 1, pattern: String(hit), text: trimmed.slice(0, 220) });
  }
}
assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
console.log(`PASS ${files.length} product source files contain no visible engineering acceptance wording`);
