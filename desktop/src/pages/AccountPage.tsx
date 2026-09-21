import { useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { EnterpriseSession } from '@/types/api'

interface AccountPageProps {
  session?: EnterpriseSession
  onSignIn(email: string, password: string): Promise<void>
}

export function AccountPage({ session, onSignIn }: AccountPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true); setError('')
    try { await onSignIn(email, password) } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试')
    } finally { setBusy(false) }
  }

  return <main className="account-page">
    <section className="account-card" aria-labelledby="account-title">
      <div className="account-mark" aria-hidden="true">W</div>
      <h1 id="account-title">登录</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label><span>账号</span><input autoFocus type="email" name="email" value={email} autoComplete="username" placeholder="name@company.com" onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>密码</span><input type="password" name="password" value={password} autoComplete="current-password" placeholder="输入密码" onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button type="submit" className="account-submit" disabled={busy || !email.trim() || !password}>{busy ? <><LoaderCircle className="spin" size={15}/>正在登录</> : <>继续<ArrowRight size={15}/></>}</button>
      </form>
      <small>{session?.environment.origin || '正在读取企业环境'}{session && !session.environment.secure ? ' · 内网 HTTP' : ''}</small>
    </section>
  </main>
}
