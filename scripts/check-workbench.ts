/** Independent Workbench product build and regression gate. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')
const gates: readonly (readonly string[])[] = [
  ['run', 'build:workbench'],
  ['run', 'verify-runtime-closure'],
  ['run', 'verify-client-packages'],
  ['run', 'verify-client-ui-i18n'],
  ['exec', 'vitest', 'run', 'scripts/ci-workflow.spec.ts', 'scripts/workbench.spec.ts', 'scripts/client-build-environment.client.spec.ts'],
  ['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'apps/cli/tests/profiles/workbench.e2e.ts'],
  ['exec', 'vitest', 'run', 'packages/bundle/workbench-app/tests', 'packages/api/session-controller/tests', 'packages/api/workspace-controller/tests', 'packages/client/connection/tests', 'packages/mcp/mcp-client/tests', 'packages/core/session/tests'],
  ['run', 'test:gui'],
]
for (const args of gates) {
  console.log(`\nWorkbench check: pnpm ${args.join(' ')}`)
  const invocation = pnpmInvocation(args)
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, env: process.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('Workbench independent build and regression checks passed.')
