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
  it('persists revision upload and receipt checkpoints across store recreation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'handoff-checkpoint-'))
    const codec = { available: () => true, encrypt: (value: string) => Buffer.from(value).reverse(), decrypt: (value: Buffer) => value.reverse().toString() }
    try {
      const first = new HandoffStore({ directory, codec })
      await first.checkpoint('revision:round-1', 'fixed-package', { phase: 'uploaded', fileIds: ['primary', 'attachment'] })
      const reopened = new HandoffStore({ directory, codec })
      expect(await reopened.inspect('revision:round-1')).toEqual({ fingerprint: 'fixed-package', value: { phase: 'uploaded', fileIds: ['primary', 'attachment'] } })
      await reopened.checkpoint('revision:round-1', 'fixed-package', { phase: 'receipt', state: 'resume_unknown' })
      const recovered = await new HandoffStore({ directory, codec }).inspect('revision:round-1')
      expect(recovered).toEqual({ fingerprint: 'fixed-package', value: { phase: 'receipt', state: 'resume_unknown' } })
      await expect(reopened.checkpoint('revision:round-1', 'changed-package', { phase: 'request_started' })).rejects.toThrow('已冻结')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('serializes concurrent phase checkpoints in call order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'handoff-checkpoint-order-'))
    const codec = { available: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }
    try {
      const store = new HandoffStore({ directory, codec })
      await Promise.all([
        store.checkpoint('revision:round-2', 'fixed-package', { phase: 'upload_started' }),
        store.checkpoint('revision:round-2', 'fixed-package', { phase: 'uploaded' }),
        store.checkpoint('revision:round-2', 'fixed-package', { phase: 'request_started' }),
      ])
      expect(await new HandoffStore({ directory, codec }).inspect('revision:round-2')).toEqual({
        fingerprint: 'fixed-package', value: { phase: 'request_started' },
      })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
