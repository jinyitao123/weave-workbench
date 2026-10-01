// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudienceEditor } from '../../src/pages/team-workspace/AudienceEditor'

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
