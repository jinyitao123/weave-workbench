import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { HandoffStore, submissionUUID } from '../../electron/main/enterprise/handoff-store'

describe('durable frozen handoff', () => {
  it('uses an RFC 9562 UUID and isolates account and intent', () => {
    expect(submissionUUID('account:turn:team')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(submissionUUID('account:turn:team')).toBe(submissionUUID('account:turn:team'))
    expect(submissionUUID('other:turn:team')).not.toBe(submissionUUID('account:turn:team'))
  })
  it('restores the exact payload after recreating the store and refuses a changed request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'handoff-store-'))
    const codec = { available: () => true, encrypt: (value: string) => Buffer.from(value).reverse(), decrypt: (value: Buffer) => value.reverse().toString() }
    try {
      const first = new HandoffStore({ directory, codec })
      const body = { task: '合同正文原版', sourceMessages: [{ messageId: 'employee-1', sha256: 'audit' }] }
      await first.freeze('account-1:request', 'original', async () => body)
      expect((await readFile(join(directory, (await readdir(directory))[0]))).toString()).not.toContain('合同正文原版')
      const reopened = new HandoffStore({ directory, codec }), prepare = vi.fn(async () => ({ task: 'changed' }))
      expect(await reopened.freeze('account-1:request', 'original', prepare)).toEqual(body)
      expect(prepare).not.toHaveBeenCalled()
      await expect(reopened.freeze('account-1:request', 'changed', prepare)).rejects.toThrow('已冻结')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
