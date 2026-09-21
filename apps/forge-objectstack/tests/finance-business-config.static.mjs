import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/finance-business-config.page.ts', import.meta.url), 'utf8');
const object = readFileSync(new URL('../src/objects/business-setting.object.ts', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../src/data/business-setting.seed.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../objectstack.config.ts', import.meta.url), 'utf8');

test('Forge 导航移除系统设置并把业务设置提升为独立区域', () => {
  assert.match(config, /id: 'business_settings', label: '业务设置'/);
  assert.doesNotMatch(config, /id: 'system', label: '系统'/);
  assert.doesNotMatch(config, /group\('system_settings'/);
});

test('财务配置从占位页切换到独立页面', () => {
  assert.match(config, /page\('finance_business_config', '付款方式与费用类别', 'page_finance_business_config'/);
  assert.doesNotMatch(config, /page\('finance_config_gap'/);
});

test('付款方式和费用类别具有完整持久化操作', () => {
  for (const token of ["'POST'", "method:'PATCH'", "method:'DELETE'", '确认删除', '点击停用', '上级类别']) assert.match(page, new RegExp(token));
  assert.match(object, /forge_business_setting_option/);
  assert.match(object, /trackHistory: true/);
});

test('种子与 RISEMAP 当前付款方式一致并包含分层费用类别', () => {
  for (const label of ['银行转账', '支付宝', '微信支付', '现金', '支票', '其他', '电汇', '承兑汇票', '在线支付', '信用证']) assert.match(seed, new RegExp(label));
  assert.match(seed, /parent_code/);
  assert.match(seed, /项目差旅费用/);
  assert.match(seed, /财务法务费用/);
  for (const leaf of ['客户拜访费', '项目餐饮补贴', '供应商考察费', '研发测试件费用', '办公耗材费', '招聘平台费', '代理记账费', '合同审查费']) assert.match(seed, new RegExp(leaf));
  assert.match(page, /children\.map\(child=><Row/);
});

test('三档布局避免设置项控件挤压', () => {
  assert.match(page, /@media\(max-width:980px\)/);
  assert.match(page, /@media\(max-width:760px\)/);
  assert.match(page, /@media\(max-width:520px\)/);
  assert.match(page, /minmax\(0,1fr\)/);
  assert.doesNotMatch(page, /\.danger\{display:none\}/);
});
