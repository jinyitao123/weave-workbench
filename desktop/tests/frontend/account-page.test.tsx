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
    await act(async () => root.render(<EnterpriseAccountSettings session={{ version: '1', status: 'signed-in', storage: 'encrypted', environment: { origin: 'http://forge.example.test', secure: false }, user: { id: 'employee', name: 'Employee', email: 'employee@example.test' }, organization: { id: 'default', name: 'Default' }, permissions: ['teams:use'] }} onSignIn={async () => undefined} onSignOut={async () => undefined} />))
    expect(container.textContent).toContain('Employee')
    expect(container.textContent).toContain('退出登录')
    expect(container.querySelector('form')).toBeNull()
  })

  it('shows saved origins and requires an explicit normal restart before signing in', async () => {
    const onSignIn = vi.fn(async () => undefined), restart = vi.fn(async () => undefined)
    const config = { version: 1 as const, forgeOrigin: 'https://forge.example.test', weaveOrigin: 'https://weave.example.test' }
    const select = vi.fn(async () => ({ status: 'saved' as const, config, environmentOverride: false, restartRequired: true }))
    await act(async () => root.render(<AccountPage onSignIn={onSignIn} onImportConnection={select} onRestartConnection={restart} />))
    const importButton = [...container.querySelectorAll('button')].find(button => button.textContent === '导入组织连接')!
    await act(async () => importButton.click())
    expect(container.textContent).toContain(config.forgeOrigin)
    expect(container.textContent).toContain(config.weaveOrigin)
    expect(container.textContent).toContain('重启后生效')
    expect(onSignIn).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    const restartButton = [...container.querySelectorAll('button')].find(button => button.textContent === '重启应用')!
    await act(async () => restartButton.click())
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('does not claim developer overrides changed or restart after a cancelled import', async () => {
    const config = { version: 1 as const, forgeOrigin: 'https://forge.example.test', weaveOrigin: 'https://weave.example.test' }
    const select = vi.fn<() => Promise<import('../../src/types/api').EnterpriseConnectionImportResult>>()
      .mockResolvedValueOnce({ status: 'saved', config, environmentOverride: true, restartRequired: false })
      .mockResolvedValueOnce({ status: 'cancelled' })
    const restart = vi.fn(async () => undefined)
    await act(async () => root.render(<AccountPage onSignIn={async () => undefined} onImportConnection={select} onRestartConnection={restart} />))
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '导入组织连接')!
    await act(async () => button.click())
    expect(container.textContent).toContain('当前仍使用开发连接覆盖')
    expect([...container.querySelectorAll('button')].some(item => item.textContent === '重启应用')).toBe(false)
    const before = container.textContent
    await act(async () => button.click())
    expect(container.textContent).toBe(before)
    expect(restart).not.toHaveBeenCalled()
  })
})
