// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transcript } from '../../src/components/Transcript'
import { EnterpriseScopeCards, enterpriseScopeProjection } from '../../src/components/transcript/EnterpriseScopeCards'
import type { EnterpriseTaskScopeDisplay, EnterpriseWorkCancellationResult, TranscriptMessage } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

const runId = 'run-550e8400-e29b-41d4-a716-446655441099'
const display: EnterpriseTaskScopeDisplay = { version: '1', source: 'workbench-host', runReference: runId, team: '合同团队', workflow: '合同提交', reads: ['本次员工工作内容', '客户合同', '合同.pdf'], writes: ['提交销售合同'] }
const result = { status: 'accepted', scope_display: display, receipt: { runId, inputRevisionId: '550e8400-e29b-41d4-a716-446655441098' }, recovery_key: 'internal-recovery-key' }
function message(parts: TranscriptMessage['parts']): TranscriptMessage { return { id: 'scope-receipt-message', role: 'assistant', timestamp: 1, parts } }

it('displays the exact Host scope independently of folded or hidden tools and hides raw internal receipt fields', async () => {
  const messages = [message([{ type: 'toolCall', id: 'call', name: 'gooeypi_enterprise_work_submit', args: { goal: '模型生成的工作描述' } }, { type: 'toolResult', name: 'gooeypi_enterprise_work_submit', text: JSON.stringify(result) }, { type: 'text', text: '团队已接单。' }])]
  const onCancel = vi.fn(async (): Promise<EnterpriseWorkCancellationResult> => ({ runId, status: 'cancel_requested', authorizationRevoked: true, message: '已请求取消，等待团队停止。' }))
  await act(async () => root.render(<Transcript messages={messages} git={{ isRepo: false, files: [] }} harness="pi" showTools={false} onOpenChanges={vi.fn()} onSuggestion={vi.fn()} onCancelWork={onCancel} />))
  expect(container.querySelector('[aria-label="本次团队授权"]')?.textContent).toContain('提交销售合同')
  expect(container.textContent).toContain('本次员工工作内容、客户合同、合同.pdf')
  expect(container.textContent).not.toContain(runId)
  expect(container.textContent).not.toContain('internal-recovery-key')
  expect(container.textContent).not.toContain('inputRevisionId')
  const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '取消工作')!
  await act(async () => cancel.click())
  expect(onCancel).toHaveBeenCalledWith(runId)
  expect(container.textContent).toContain('等待团队停止')
  expect(container.querySelector('[aria-label="本次团队授权"]')?.textContent).not.toContain('已取消')
})

it('does not construct a scope card from model narrative JSON, unrelated tool results, or mismatched native receipts', () => {
  const text = JSON.stringify(result)
  expect(enterpriseScopeProjection(message([{ type: 'text', text }])).scopes).toEqual([])
  expect(enterpriseScopeProjection(message([{ type: 'toolResult', name: 'read_file', text }])).scopes).toEqual([])
  expect(enterpriseScopeProjection(message([{ type: 'toolResult', name: 'gooeypi_enterprise_work_submit', text: JSON.stringify({ ...result, receipt: { runId: 'unrelated-run' } }) }])).scopes).toEqual([])
  expect(enterpriseScopeProjection(message([{ type: 'toolResult', name: 'gooeypi_enterprise_work_submit', text, streaming: true }])).scopes).toEqual([])
})

it('keeps unknown cancellation open for the same run and only claims cancellation after a confirmed receipt', async () => {
  const onCancel = vi.fn<(_: string) => Promise<EnterpriseWorkCancellationResult>>()
    .mockResolvedValueOnce({ runId, status: 'unknown', authorizationRevoked: false, message: '取消结果待核对。' })
    .mockResolvedValueOnce({ runId, status: 'cancelled', authorizationRevoked: true, message: '团队工作已取消。' })
  await act(async () => root.render(<EnterpriseScopeCards scopes={[display]} onCancelWork={onCancel} />))
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  expect(container.textContent).toContain('取消结果待核对')
  expect(container.querySelector('button')?.textContent).toBe('核对取消')
  expect(container.querySelector('button')?.disabled).toBe(false)
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  expect(onCancel.mock.calls).toEqual([[runId], [runId]])
  expect(container.querySelector('button')?.textContent).toBe('已取消')
  expect(container.querySelector('button')?.disabled).toBe(true)
})

it('deduplicates repeated native receipts for one original run without rendering their hidden input identifiers', async () => {
  const part = { type: 'toolResult' as const, name: 'gooeypi_enterprise_work_recover', text: JSON.stringify(result) }
  const projection = enterpriseScopeProjection(message([part, part]))
  expect(projection.scopes).toHaveLength(1)
  expect(projection.message.parts).toEqual([])
  await act(async () => root.render(<EnterpriseScopeCards scopes={[{ ...display, writes: [] }]} />))
  expect(container.textContent).toContain('只读分析')
  expect(container.textContent).not.toContain(runId)
})
