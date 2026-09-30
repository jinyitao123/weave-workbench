// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { WorkActionReceipt } from '../../src/components/WorkActionReceipt'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('keeps an empty action receipt separate from a model summary that claims submission', async () => {
  await act(async () => root.render(<WorkActionReceipt outcomes={[]}/>))

  expect(container.textContent).toContain('本次没有记录业务动作回执')
  expect(container.textContent).toContain('不能根据团队摘要认定已提交')
})

it('shows successful, failed, and unknown platform action outcomes without promoting unknown to success', async () => {
  await act(async () => root.render(<WorkActionReceipt outcomes={[
    { actionName: 'submit', objectName: 'record', status: 'succeeded', summary: '提交已确认' },
    { actionName: 'update', objectName: 'record', status: 'failed', summary: '更新失败' },
    { actionName: 'resume', objectName: 'record', status: 'unknown', summary: '结果未知' },
  ]}/>))

  expect(container.textContent).toContain('Forge 已确认成功')
  expect(container.textContent).toContain('Forge 已确认失败')
  expect(container.textContent).toContain('结果未知，不能视为成功')
})

it('states when the work message carries no action receipt', async () => {
  await act(async () => root.render(<WorkActionReceipt/>))

  expect(container.textContent).toContain('没有附带业务动作回执')
  expect(container.textContent).toContain('团队摘要不能证明业务已提交')
})
