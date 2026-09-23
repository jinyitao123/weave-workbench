import { describe, expect, it } from 'vitest'
import { appendWorkspaceMaterialContext, splitWorkspaceMaterialContext } from '../../src/lib/workspace-material-attachments'
import type { WorkspaceMaterialReference } from '../../src/types/api'

const attachment: WorkspaceMaterialReference = {
  projectId: 'personal-project',
  harness: 'pi',
  workspacePath: '/workspace/personal',
  name: 'source.md',
  path: '材料/附件/opaque/source.md',
  sha256: 'a'.repeat(64),
  bytes: 14,
  mimeType: 'text/markdown',
}

describe('workspace material prompt references', () => {
  it('keeps file contents out of the prompt while persisting the exact path and digest reference', () => {
    const text = appendWorkspaceMaterialContext('Please review this file.', [attachment])
    const parsed = splitWorkspaceMaterialContext(text)

    expect(text).toContain(attachment.path)
    expect(text).toContain(attachment.sha256)
    expect(text).not.toContain('source.md contents')
    expect(parsed.text).toBe('Please review this file.')
    expect(parsed.attachments).toEqual([{
      name: attachment.name,
      path: attachment.path,
      sha256: attachment.sha256,
      bytes: attachment.bytes,
      mimeType: attachment.mimeType,
    }])
  })

  it('fails closed on an attachment reference outside the workspace Materials folder', () => {
    expect(() => appendWorkspaceMaterialContext('Read this file.', [{ ...attachment, path: '../outside.md' }]))
      .toThrow(/do not belong to the current workspace/)
  })
})
