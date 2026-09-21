// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseAccountSettings } from '../../src/pages/settings/EnterpriseAccountSettings'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('GooeyPi enterprise account settings', () => {
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('submits one Forge credential form and never renders a second Weave login', async () => {
    const onSignIn = vi.fn(async () => undefined)
    await act(async () => root.render(<EnterpriseAccountSettings session={{ version: '1', status: 'signed-out', storage: 'session-only', environment: { origin: 'http://forge.example.test', secure: false } }} onSignIn={onSignIn} onSignOut={async () => undefined} />))
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0]!, 'developer@example.test')
      setInput(inputs[1]!, 'secret')
    })
    await act(async () => container.querySelector<HTMLFormElement>('form')!.requestSubmit())
    expect(onSignIn).toHaveBeenCalledWith('developer@example.test', 'secret')
    expect(container.textContent).toContain('使用 Forge 账号登录')
    expect(container.textContent).not.toContain('Weave 密码')
  })

  it('shows a bounded login error without echoing the password', async () => {
    const onSignIn = vi.fn(async () => { throw new Error('账号或密码不正确') })
    await act(async () => root.render(<EnterpriseAccountSettings onSignIn={onSignIn} onSignOut={async () => undefined} />))
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0]!, 'member@example.test')
      setInput(inputs[1]!, 'secret-value')
    })
    await act(async () => container.querySelector<HTMLFormElement>('form')!.requestSubmit())
    expect(container.textContent).toContain('账号或密码不正确')
    expect(container.textContent).not.toContain('secret-value')
  })
})
