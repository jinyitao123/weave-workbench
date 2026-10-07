import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { z } = createRequire(require.resolve('@objectstack/mcp'))('zod');
import { nativeActionConfirmationSupported, nativeActionRequiresConfirmation } from '../src/plugins/native-action-confirmation.ts';

test('installed public MCP registration declares a closed boolean confirmation member', () => {
  assert.equal(nativeActionConfirmationSupported(), true);
});

test('legacy or incompatible protocol declarations cannot express a gated action', () => {
  const register = inputSchema => server => server.registerTool('run_action', { inputSchema }, async () => ({}));
  assert.equal(nativeActionConfirmationSupported(register({ actionName: z.string() })), false);
  assert.equal(nativeActionConfirmationSupported(register({ confirm: z.string().optional() })), false);
  assert.equal(nativeActionConfirmationSupported(register({ confirm: z.boolean().nullable().optional() })), false);
  assert.equal(nativeActionConfirmationSupported(register(z.object({ confirm: z.boolean().optional() }))), true);
});

test('only the validated native declaration supplies the need for confirmation', () => {
  assert.equal(nativeActionRequiresConfirmation({}), false);
  assert.equal(nativeActionRequiresConfirmation({ ai: { requiresConfirmation: false } }), false);
  assert.equal(nativeActionRequiresConfirmation({ ai: { requiresConfirmation: true } }), true);
  assert.throws(() => nativeActionRequiresConfirmation({ ai: { requiresConfirmation: 'true' } }), /声明无效/);
  assert.throws(() => nativeActionRequiresConfirmation({ ai: [] }), /声明无效/);
});
