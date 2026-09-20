// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseSettings } from '../../src/pages/settings/EnterpriseSettings'
import type { EnterpriseAccountState, PrimeWorkApi } from '../../src/types/api'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('EnterpriseSettings product access', () => {
  it('renders each server decision and its reason instead of identity roles', async () => {
    const account: EnterpriseAccountState = {
      version: '1', status: 'signed-in', environment: { origin: 'https://forge.example.test', secure: true }, storage: 'encrypted',
      identitySource: { kind: 'forge-oauth', issuer: 'https://forge.example.test' },
      user: { id: 'user-1', name: '开发者', email: 'developer@example.test' }, organization: { id: 'org-1', name: '客户组织' }, roles: ['admin'],
      access: {
        version: '1', status: 'ready', subject: { id: 'user-1', organizationId: 'org-1' }, source: { kind: 'weave', policyVersion: 'builtin-v1' }, evaluatedAt: '2026-09-20T08:00:00.000Z',
        capabilities: [
          { id: 'team.read', decision: 'allow', reason: '已授权查看团队' },
          { id: 'run.read', decision: 'allow', reason: '已授权查看运行' },
          { id: 'debug.simulate', decision: 'allow', reason: '已授权只读模拟' },
          { id: 'debug.sandbox_write', decision: 'deny', reason: '尚未接入沙箱' },
          { id: 'release.publish', decision: 'deny', reason: '发布需要独立授权' },
        ],
      },
    }
    const enterprise = {
      getAccount: vi.fn().mockResolvedValue(account),
      signIn: vi.fn(),
      signOut: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as PrimeWorkApi['enterprise']

    await act(async () => { root.render(<EnterpriseSettings enterprise={enterprise} />); await Promise.resolve() })

    expect(container.querySelectorAll('.enterprise-capability')).toHaveLength(5)
    expect(container.textContent).toContain('查看团队')
    expect(container.textContent).toContain('只读模拟')
    expect(container.textContent).toContain('尚未接入沙箱')
    expect(container.textContent).toContain('发布需要独立授权')
    expect(container.textContent).not.toContain('admin')
  })
})
