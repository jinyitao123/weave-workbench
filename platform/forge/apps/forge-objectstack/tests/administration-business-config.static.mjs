import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/administration-business-config.page.ts', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../src/data/business-setting.seed.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../objectstack.config.ts', import.meta.url), 'utf8');

test('行政配置已从占位页切换到独立页面', () => {
  assert.match(config, /page\('administration_business_config', '行政管理配置', 'page_administration_business_config'/);
  assert.doesNotMatch(config, /page\('administration_config_gap'/);
});

test('九类 RISEMAP 行政设置均有可操作入口', () => {
  for (const label of ['资产分类', '物料类别', '购买渠道', '福利分类', '会议类型', '资质类别', '申报类别', '申报阶段', '借用原因']) assert.match(page, new RegExp(label));
  for (const token of ["'POST'", "method:'PATCH'", "method:'DELETE'", '确认删除', '上级分类', '借用方向']) assert.match(page, new RegExp(token));
});

test('当前 RISEMAP 可见行政字典已写入幂等种子', () => {
  for (const label of ['软件/无形资产', '电子设备\\(IT\\)', '五金工具', '京东企业购', '节日福利\\(春节/端午/中秋\\)', '项目会议', '高新技术企业', '待评估']) assert.match(seed, new RegExp(label));
  assert.match(seed, /scope: 'administration'/);
});

test('三档布局保护长名称与多按钮状态', () => {
  for (const breakpoint of ['980px', '760px', '520px']) assert.match(page, new RegExp('@media\\(max-width:' + breakpoint + '\\)'));
  assert.match(page, /minmax\(0,1fr\)/);
  assert.match(page, /text-overflow:ellipsis/);
});
