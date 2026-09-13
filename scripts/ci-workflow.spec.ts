/** The independent product gate must not depend on parent source or legacy release jobs. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
describe('Workbench CI contract', () => {
  it('builds and tests the complete product from this repository with locked dependencies', () => {
    const workflow = yaml.load(readFileSync(resolve(root, '.github/workflows/workbench.yml'), 'utf8')) as {
      permissions: { contents: string }; jobs: { product: { steps: { run?: string; uses?: string; with?: { version?: string; dest?: string } }[] } }
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const steps = workflow.jobs.product.steps
    expect(steps.some(step => step.run === 'pnpm install --frozen-lockfile')).toBe(true)
    expect(steps.some(step => step.run === 'pnpm run check:workbench')).toBe(true)
    expect(steps.find(step => step.uses === 'pnpm/action-setup@v4')?.with).toMatchObject({ version: '11.7.0' })
    expect(steps.find(step => step.uses === 'pnpm/action-setup@v4')?.with?.dest).toContain('runner.temp')
    expect(steps.some(step => /go build|make workbench|python-v|npm publish/.test(step.run ?? ''))).toBe(false)
  })
  it('keeps the standalone gate and image inside the source boundary', () => {
    const gate = readFileSync(resolve(root, 'scripts/check-workbench.ts'), 'utf8')
    expect(gate).toContain("['run', 'build:workbench']")
    expect(gate).toContain("['run', 'test:gui']")
    expect(gate).toContain('packages/bundle/workbench-app/tests')
    const image = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
    expect(image).toContain('COPY . .')
    expect(image).not.toMatch(/COPY workbench\/|COPY --from=weave|FROM \$\{WEAVE_IMAGE\}/)
  })
})
