// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '../../src/pages/AccountPage'
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

describe('GooeyPi enterprise account entry', () => {
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('submits one Forge credential form and never renders a second Weave login', async () => {
    const onSignIn = vi.fn(async () => undefined)
    await act(async () => root.render(<AccountPage session={{ version: '1', status: 'signed-out', storage: 'session-only', environment: { origin: 'http://forge.example.test', secure: false } }} onSignIn={onSignIn} />))
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0]!, 'developer@example.test')
      setInput(inputs[1]!, 'secret')
    })
    await act(async () => container.querySelector<HTMLFormElement>('form')!.requestSubmit())
    expect(onSignIn).toHaveBeenCalledWith('developer@example.test', 'secret')
    expect(container.textContent).toContain('登录')
    expect(container.textContent).not.toContain('首次登录')
    expect(container.textContent).not.toContain('Weave 密码')
  })

  it('shows a bounded login error without echoing the password', async () => {
    const onSignIn = vi.fn(async () => { throw new Error('账号或密码不正确') })
    await act(async () => root.render(<AccountPage onSignIn={onSignIn} />))
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0]!, 'member@example.test')
      setInput(inputs[1]!, 'secret-value')
    })
    await act(async () => container.querySelector<HTMLFormElement>('form')!.requestSubmit())
    expect(container.textContent).toContain('账号或密码不正确')
    expect(container.textContent).not.toContain('secret-value')
  })

  it('keeps signed-in account management in settings without another login form', async () => {
    await act(async () => root.render(<EnterpriseAccountSettings session={{ version: '1', status: 'signed-in', storage: 'encrypted', environment: { origin: 'http://forge.example.test', secure: false }, user: { id: 'employee', name: 'Employee', email: 'employee@example.test' }, organization: { id: 'default', name: 'Default' }, role: 'member' }} onSignIn={async () => undefined} onSignOut={async () => undefined} />))
    expect(container.textContent).toContain('Employee')
    expect(container.textContent).toContain('退出登录')
    expect(container.querySelector('form')).toBeNull()
  })
})
