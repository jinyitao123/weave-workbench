import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { EnterpriseSession } from '@/types/api'

interface EnterpriseAccountSettingsProps {
  session?: EnterpriseSession
  onSignIn(email: string, password: string): Promise<void>
  onSignOut(): Promise<void>
}

export function EnterpriseAccountSettings({ session, onSignIn, onSignOut }: EnterpriseAccountSettingsProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true); setError('')
    try {
      await onSignIn(email, password)
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试')
    } finally { setBusy(false) }
  }

  const signOut = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await onSignOut() } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出失败，请稍后重试')
    } finally { setBusy(false) }
  }

  return <div className="settings-section enterprise-account-settings">
    <div className="settings-section__header"><h1>企业账号</h1><p>使用 Forge 账号登录，Workbench 会自动连接对应的 Weave 身份。</p></div>
    <section className="settings-group">
      <h2>Forge 与 Weave</h2>
      {session?.status === 'signed-in' && session.user ? <div className="settings-row enterprise-account-summary">
        <span><strong>{session.user.name}</strong><small>{session.user.email} · {session.role} · {session.organization?.name ?? session.organization?.id}</small></span>
        <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>{busy ? '正在退出…' : '退出登录'}</button>
      </div> : <form className="enterprise-account-form" onSubmit={(event) => void submit(event)}>
        <label><span>账号</span><input type="email" name="email" value={email} autoComplete="username" placeholder="name@company.com" onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>密码</span><input type="password" name="password" value={password} autoComplete="current-password" placeholder="输入密码" onChange={(event) => setPassword(event.target.value)} /></label>
        <button type="submit" className="button button--primary" disabled={busy || !email.trim() || !password}>{busy ? <><LoaderCircle className="spin" size={13}/>正在登录</> : <>登录<ArrowRight size={13}/></>}</button>
      </form>}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      <p className="enterprise-account-origin">{session?.environment.origin || '正在读取 Forge 环境'}{session && !session.environment.secure ? ' · 内网 HTTP' : ''}</p>
    </section>
  </div>
}
