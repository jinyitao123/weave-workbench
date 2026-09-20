import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const pageDirectory = new URL('../src/pages/', import.meta.url);
const files = (await readdir(pageDirectory)).filter(name => name.endsWith('.page.ts'));
const forbidden = [
  ['浏览器原生下拉', /<select\b/],
  ['浏览器原生日期控件', /type=["'](?:date|datetime-local)["']/],
  ['浏览器原生弹框', /window\.(?:alert|confirm|prompt)\s*\(/],
];

for (const file of files) {
  const source = await readFile(new URL(file, pageDirectory), 'utf8');
  for (const [label, pattern] of forbidden) assert.equal(pattern.test(source), false, `${file} 仍包含${label}`);
  if (/Forge(?:SelectControl|DateInput|DateTimeInput)/.test(source)) {
    assert.match(source, /forgeProductUiRuntime/, `${file} 使用共享控件但未注入运行时`);
  }
}

const artifact = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
for (const page of artifact.pages || []) {
  for (const [label, pattern] of forbidden) assert.equal(pattern.test(page.source || ''), false, `${page.name} 构建产物仍包含${label}`);
}

console.log(`PASS ${files.length} 个页面源码和 ${(artifact.pages || []).length} 个构建页面均未使用浏览器原生弹框、下拉或日期控件`);
