import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/administration-notice.page.ts', import.meta.url), 'utf8');
const objects = await readFile(new URL('../src/objects/administration.object.ts', import.meta.url), 'utf8');
for (const token of ['page_administration_notice','forge_company_notice','发布通知','保存草稿','撤回','接收范围','阅读情况','ForgeDialog']) assert.ok(page.includes(token), `missing page token ${token}`);
for (const token of ['CompanyNotice','forge_company_notice','audience_type','published_at','withdrawn_at','recipient_count']) assert.ok(objects.includes(token), `missing object token ${token}`);
assert.ok(!page.includes('window.alert('));
assert.ok(!page.includes('window.confirm('));
console.log(JSON.stringify({suite:'administration-notice-static',pages:1,objects:1,status:'passed'},null,2));
