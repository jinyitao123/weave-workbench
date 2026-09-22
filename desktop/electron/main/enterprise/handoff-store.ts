import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
export function submissionUUID(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export interface HandoffStorage {
  directory: string
  codec: { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
}
/** Per-account immutable checkpoints. Callers persist local intent before network preparation. */
export class HandoffStore {
  private readonly memory = new Map<string, { fingerprint: string; value: unknown }>()
  private readonly pending = new Map<string, Promise<unknown>>()
  constructor(private readonly storage?: HandoffStorage) {}

  async freeze<T>(key: string, fingerprint: string, prepare: () => Promise<T>): Promise<T> {
    const prior = this.pending.get(key)
    if (prior) { await prior; return this.freeze(key, fingerprint, prepare) }
    const operation = this.loadOrPrepare(key, fingerprint, prepare)
    this.pending.set(key, operation)
    try { return await operation } finally { this.pending.delete(key) }
  }

  async recover<T>(recoveryKey: string): Promise<T> {
    if (!/^[0-9a-f]{64}$/.test(recoveryKey)) throw new Error('交接恢复凭据无效')
    for (const [key, saved] of this.memory) if (digest(key) === recoveryKey) return structuredClone(saved.value) as T
    if (!this.storage?.codec.available()) throw new Error('无法读取原交接记录')
    try {
      const saved = JSON.parse(this.storage.codec.decrypt(await readFile(join(this.storage.directory, `${recoveryKey}.bin`)))) as { value: T }
      return saved.value
    } catch { throw new Error('无法读取原交接记录，请勿重新创建重复工作') }
  }

  private async loadOrPrepare<T>(key: string, fingerprint: string, prepare: () => Promise<T>): Promise<T> {
    let saved = this.memory.get(key)
    const path = this.storage ? join(this.storage.directory, `${digest(key)}.bin`) : undefined
    if (!saved && path && this.storage) {
      if (!this.storage.codec.available()) throw new Error('安全存储不可用，无法保存可恢复的交接')
      try { saved = JSON.parse(this.storage.codec.decrypt(await readFile(path))) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取原交接记录，请勿重新创建重复工作')
      }
    }
    if (saved) {
      if (saved.fingerprint !== fingerprint) throw new Error('本轮交接内容已冻结；目标或材料变化后请由员工发起新一轮交接')
      this.memory.set(key, saved)
      return structuredClone(saved.value) as T
    }
    const value = await prepare()
    saved = { fingerprint, value }
    if (path && this.storage) {
      await mkdir(this.storage.directory, { recursive: true, mode: 0o700 })
      const temp = `${path}.tmp`
      await writeFile(temp, this.storage.codec.encrypt(JSON.stringify(saved)), { mode: 0o600 })
      await rename(temp, path)
    }
    this.memory.set(key, saved)
    return structuredClone(value)
  }
}
