import { expect, it, vi } from 'vitest'
import { readApprovalPages } from '../../electron/main/enterprise/inbox-pages'

function requests(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `approval-${start + index}`, status: 'pending' }))
}

it('deduplicates identical approval rows without hiding missing rows from the native total', async () => {
  const read = vi.fn().mockResolvedValueOnce({ data: requests(0, 50), total: 101 })
    .mockResolvedValueOnce({ data: requests(49, 50), total: 101 })
    .mockResolvedValueOnce({ data: requests(99, 2), total: 101 })
  const result = await readApprovalPages(read)
  expect(result.data).toHaveLength(101)
  expect(new Set(result.data.map((value) => (value as { id: string }).id)).size).toBe(101)
  expect(read.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/approvals/requests?limit=50', '/api/v1/approvals/requests?limit=50&offset=50', '/api/v1/approvals/requests?limit=50&offset=100',
  ])
})

it('continues legacy native approval pages without a total until an explicit short page', async () => {
  const read = vi.fn().mockResolvedValueOnce({ data: requests(0, 50) }).mockResolvedValueOnce({ data: requests(50, 3) })
  expect((await readApprovalPages(read)).data).toHaveLength(53)
  expect(read).toHaveBeenCalledTimes(2)
})

it.each([
  { next: { data: requests(0, 50), total: 51 }, error: '分页没有继续前进' },
  { next: { data: [], total: 51 }, error: '分页未能完整读取' },
  { next: { data: [{ id: 'approval-0', status: 'returned' }], total: 51 }, error: '事项在读取期间已变化' },
  { next: { data: requests(50, 1), total: 52 }, error: '列表在读取期间已变化' },
  { next: { data: requests(50, 1), total: -1 }, error: '总量格式无效' },
  { next: { unexpected: [] }, error: '分页格式无效' },
])('refuses incomplete or changed native approval pages: $error', async ({ next, error }) => {
  const read = vi.fn().mockResolvedValueOnce({ data: requests(0, 50), total: 51 }).mockResolvedValueOnce(next)
  await expect(readApprovalPages(read)).rejects.toThrow(error)
  expect(read).toHaveBeenCalledTimes(2)
})
