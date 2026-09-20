import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pagesDir = new URL('../src/pages/', import.meta.url);
const files = (await readdir(pagesDir))
  .filter(name => name.endsWith('.page.ts'))
  .filter(name => name.startsWith('sales') || name.includes('service') || name.includes('goodwill') || name.includes('warranty'));

const findings = [];

for (const name of files) {
  const path = join(pagesDir.pathname, name);
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/<button\b[^>]*>/g)) {
    const tag = match[0];
    const hasRealAction = tag.includes('onClick=') || tag.includes('type=');
    if (!hasRealAction) {
      findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, message: 'button has no click or submit behavior', tag });
    }
  }
  for (const match of text.matchAll(/<span\b[^>]*className=\{?[^>]*fp-tab/g)) {
    findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, message: 'static span still uses interactive tab styling' });
  }
  for (const match of text.matchAll(/onClick=\{\(\)\s*=>\s*\{\s*\}\}/g)) {
    findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, message: 'empty click handler is not a usable business action' });
  }
  for (const match of text.matchAll(/(?:window\.)?(alert|confirm|prompt)\s*\(/g)) {
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    if (/function\s+$/.test(before) || /(?:const|let|var)\s+$/.test(before)) continue;
    findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, message: 'browser-native dialog is not allowed for ObjectStack product pages' });
  }
}

assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
console.log('PASS sales and service pages expose no inert buttons, fake static tabs, empty handlers or native browser dialogs');
