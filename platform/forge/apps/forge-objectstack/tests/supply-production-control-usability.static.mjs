import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pagesDir = new URL('../src/pages/', import.meta.url);
const pagePrefixes = ['production', 'purchase', 'subcontract', 'bom', 'delivery', 'pending', 'collection', 'supplier'];
const files = (await readdir(pagesDir))
  .filter(name => name.endsWith('.page.ts'))
  .filter(name => pagePrefixes.some(prefix => name.startsWith(prefix)) || name.includes('inbound') || name.includes('outbound') || name.includes('inspection'));

const findings = [];

for (const name of files) {
  const path = join(pagesDir.pathname, name);
  const lines = (await readFile(path, 'utf8')).split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.includes('<button')) {
      for (const part of line.split('<button').slice(1)) {
        const segment = part.split('</button>')[0];
        if (!segment.includes('onClick=') && !segment.includes('type=')) {
          findings.push({ file: name, line: index + 1, message: 'button has no click or submit behavior', tag: ('<button' + segment).slice(0, 180) });
        }
      }
    }
    if (line.includes('onClick={()=>{}}') || line.includes('onClick={() => {}}')) {
      findings.push({ file: name, line: index + 1, message: 'empty click handler is not a usable business action' });
    }
    if (/(?<!function\s)(?<!const\s)(?<!let\s)(?<!var\s)(?:window\.)?(alert|confirm|prompt)\s*\(/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'browser-native dialog is not allowed for ObjectStack product pages' });
    }
    if (/<span\b[^>]*className=\{?[^>]*["'](?:[^"']*\s)?fp-tab(?:\s|["'])/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'static span still uses interactive tab styling' });
    }
  }
}

assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
console.log('PASS supply and production pages expose no inert buttons, fake static tabs, empty handlers or native browser dialogs');
