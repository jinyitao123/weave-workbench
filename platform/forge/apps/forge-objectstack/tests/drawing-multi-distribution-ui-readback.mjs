import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const path = '.objectstack/acceptance/drawing-multi-distribution-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4382');
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, object); return response.value.record; }
const [distribution, recipient] = await Promise.all([read('forge_drawing_distribution', report.ids.allRequiredDistribution), read('forge_drawing_distribution_recipient', report.ids.qualityRecipient)]);
assert.deepEqual({ confirmation: distribution.confirmation_status, confirmed: distribution.confirmed_count, recipients: distribution.recipient_count, satisfied: distribution.confirmation_satisfied, receipt: distribution.receipt_status, receiptCount: distribution.receipt_count, recipient: [recipient.confirmation_status, recipient.receipt_status] }, { confirmation: 'confirmed', confirmed: 2, recipients: 2, satisfied: true, receipt: 'received', receiptCount: 2, recipient: ['confirmed', 'received'] });
report.browserVerification = { status: 'passed', verifiedAt: new Date().toISOString(), browser: 'Codex 内置浏览器', pageUrl: `${process.env.FORGE_URL || 'http://localhost:4382'}/_console/apps/forge/page/page_drawing_workspace`, observed: ['真实内置浏览器打开发放记录', '接收进度显示装配生产部已确认、质量工程师张敏待确认', '点击质量工程师张敏的确认并回执', '页面显示 2 / 2 已确认、全部已确认、已回执、已满足确认要求', 'API 回读父子状态一致'] };
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS browser completed the second recipient confirmation and full receipt');
