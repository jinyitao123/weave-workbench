import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pagesDir = new URL('../src/pages/', import.meta.url);
const files = (await readdir(pagesDir)).filter(name => name.endsWith('.page.ts'));
const findings = [];

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

for (const name of files) {
  const path = join(pagesDir.pathname, name);
  const source = await readFile(path, 'utf8');
  const lines = source.split('\n');

  const buttonPattern = /<button\b[\s\S]*?<\/button>/g;
  for (const match of source.matchAll(buttonPattern)) {
    const block = match[0];
    const line = lineOf(source, match.index ?? 0);
    const compact = block.replace(/\s+/g, ' ').trim().slice(0, 260);
    if (!/onClick=/.test(block) && !/type=["']submit["']/.test(block)) {
      findings.push({ file: name, line, message: 'button must have a real click action or submit behavior', text: compact });
    }
    if (/disabled=\{?true\}?/.test(block) || /aria-disabled=\{?true\}?/.test(block) || /cursor-not-allowed|opacity-50/.test(block)) {
      findings.push({ file: name, line, message: 'permanently unavailable capability should be business text, not a disabled-looking button', text: compact });
    }
    if (/onClick=\{[\s\S]*?setToast\(/.test(block) && !/invoke|api\.|location|setDialog|setPage|setFilter|setStatus|setActive|setTab|set(?!Toast)[A-Z]|load\(/.test(block)) {
      findings.push({ file: name, line, message: 'click handlers must change business state, filter, dialog or navigation, not only show a toast', text: compact });
    }
    if (/onClick=\{\s*(?:\(\)\s*)?=>\s*\{\s*\}\s*\}/.test(block)) {
      findings.push({ file: name, line, message: 'empty click handler is not a usable business action', text: compact });
    }
    if (/暂不支持|暂未|待开发|待接入|占位|仅展示/.test(block)) {
      findings.push({ file: name, line, message: 'unfinished capability must not be rendered as a button', text: compact });
    }
  }

  for (const [index, line] of lines.entries()) {
    if (/<select\b/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'use ObjectStack or Forge select controls instead of browser-native select', text: line.trim().slice(0, 220) });
    }
    if (/<input\b[^>]*type=["']date["']/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'use ForgeDateInput instead of browser-native date input', text: line.trim().slice(0, 220) });
    }
    if (/<a\b[^>]*(href=["']#|href=\{['"]#['"]\})/.test(line) || /<a\b(?![^>]*href=)/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'links must navigate to a real destination; use business text for unavailable entries', text: line.trim().slice(0, 220) });
    }
    if (/<span\b[^>]*className=\{?[^>]*["'](?:[^"']*\s)?fp-tab(?:\s|["'])/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'static span must not use interactive tab styling' });
    }
    if (/(?<!function\s)(?<!const\s)(?<!let\s)(?<!var\s)(?:window\.)?(alert|confirm|prompt)\s*\(/.test(line)) {
      findings.push({ file: name, line: index + 1, message: 'browser-native dialog is not allowed for ObjectStack product pages', text: line.trim().slice(0, 220) });
    }
  }
}

assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
console.log(`PASS ${files.length} custom pages expose no inert buttons, fake static tabs, fake links, native select/date controls, disabled-looking buttons, empty handlers, toast-only clicks or native browser dialogs`);
