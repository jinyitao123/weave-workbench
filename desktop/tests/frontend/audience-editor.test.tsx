// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudienceEditor } from '../../src/pages/team-workspace/AudienceEditor'
import { Modal, ProductField } from '../../src/components/ui'

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
  vi.unstubAllGlobals()
})

it('keeps the employee in the audience editor when a modal initial-focus frame arrives late', async () => {
  let focusFrame: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { focusFrame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  await act(async () => root.render(<Modal title="团队资料" onClose={vi.fn()}><ProductField autoFocus label="团队名称" value="合同团队" onChange={() => {}}/><AudienceEditor value={[]} onChange={vi.fn()}/></Modal>))
  const edit = document.querySelector<HTMLButtonElement>('[aria-label="编辑可用人群内容"]')!
  await act(async () => edit.click())
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
  expect(document.activeElement).toBe(textarea)
  await act(async () => focusFrame?.(0))
  expect(document.activeElement).toBe(textarea)
  expect(document.querySelector('textarea')).toBe(textarea)
})

function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

it('edits team audience one permission set per line without losing the line being typed', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(<AudienceEditor value={[]} onChange={onChange}/>))
  expect(container.textContent).toContain('全组织可用')
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => type(textarea, 'sales_employee\n'))
  expect(onChange).toHaveBeenLastCalledWith(['sales_employee'])
  expect(textarea.value).toBe('sales_employee\n')
  await act(async () => type(textarea, 'sales_employee\ndelivery_reviewer\nsales_employee'))
  expect(onChange).toHaveBeenLastCalledWith(['sales_employee', 'delivery_reviewer'])
})
