import { defineHook } from '@objectstack/spec/data';

export const FundAccountOpeningBalance = defineHook({
  name: 'fund_account_opening_balance',
  object: 'forge_fund_account',
  events: ['beforeInsert'],
  priority: 100,
  description: '新建资金账户时，以期初余额初始化只读的当前余额。',
  body: {
    language: 'js',
    capabilities: [],
    source: `
const openingBalance = Number(ctx.input.opening_balance || 0);
if (!Number.isFinite(openingBalance) || openingBalance < 0) {
  throw new Error('期初余额必须是大于或等于零的有效金额');
}
ctx.input.current_balance = Math.round((openingBalance + Number.EPSILON) * 10000) / 10000;
`,
  },
});
