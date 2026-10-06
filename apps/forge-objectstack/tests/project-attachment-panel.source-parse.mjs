import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { formatProjectAttachmentLocalDateTime, ProjectAttachmentPanelSource } from '../src/pages/project-attachment-panel.ts';

test('project attachment panel source parses as JSX and only advertises implemented file selection', () => {
  const result = ts.transpileModule(ProjectAttachmentPanelSource, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const syntaxErrors = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(syntaxErrors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  assert.match(ProjectAttachmentPanelSource, /\/storage\/upload\/presigned/);
  assert.match(ProjectAttachmentPanelSource, /\/storage\/upload\/complete/);
  assert.match(ProjectAttachmentPanelSource, /\/actions\/forge_project\/project_attachment_create/);
  assert.match(ProjectAttachmentPanelSource, /ForgeSelectControl/);
  assert.match(ProjectAttachmentPanelSource, /selectedName\(selectedFile\)/);
  assert.match(ProjectAttachmentPanelSource, /humanFileSize\(selectedFile\.size\)/);
  assert.match(ProjectAttachmentPanelSource, /\/data\/forge_project_attachment\//);
  assert.match(ProjectAttachmentPanelSource, /当前账号无法读取保存结果/);
  assert.doesNotMatch(ProjectAttachmentPanelSource, /<select className="pa-field"/);
  assert.doesNotMatch(ProjectAttachmentPanelSource, /onDrag(?:Enter|Over|Leave|Drop)|onPaste|拖拽|Ctrl\s*\+\s*V/i);
  assert.doesNotMatch(ProjectAttachmentPanelSource, /uploaded_by:|uploaded_at:/);
});

test('attachment timestamps use the viewing runtime locale and local timezone without changing the stored instant', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utc = formatProjectAttachmentLocalDateTime('2026-10-04T03:28:00.000Z');
    process.env.TZ = 'Asia/Shanghai';
    const local = formatProjectAttachmentLocalDateTime('2026-10-04T03:28:00.000Z');
    assert.equal(utc, '2026-10-04 03:28');
    assert.equal(local, '2026-10-04 11:28');
    assert.notEqual(utc, local);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(formatProjectAttachmentLocalDateTime('invalid'), '—');
  assert.equal(formatProjectAttachmentLocalDateTime(null), '—');
  assert.doesNotMatch(formatProjectAttachmentLocalDateTime.toString(), /timeZone\s*:/);
});
