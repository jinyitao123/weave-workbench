import { useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { EnterpriseConnectionImportResult, EnterpriseSession } from '@/types/api'

interface AccountPageProps {
  session?: EnterpriseSession
  onSignIn(email: string, password: string): Promise<void>
  onImportConnection?(): Promise<EnterpriseConnectionImportResult>
  onRestartConnection?(): Promise<void>
}

export function AccountPage({ session, onSignIn, onImportConnection, onRestartConnection }: AccountPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<EnterpriseConnectionImportResult>()
  const importConnection = async () => {
    if (busy || !onImportConnection) return
    setBusy(true); setError('')
    try { const result = await onImportConnection(); if (result.status !== 'cancelled') { setConnection(result); if (result.restartRequired) setPassword('') } }
    catch (reason) { setError(reason instanceof Error ? reason.message : '连接导入失败') }
    finally { setBusy(false) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || (connection?.status !== 'cancelled' && connection?.restartRequired) || !email.trim() || !password) return
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
        <button type="submit" className="account-submit" disabled={busy || (connection?.status !== 'cancelled' && connection?.restartRequired) || !email.trim() || !password}>{busy ? <><LoaderCircle className="spin" size={15}/>正在登录</> : <>继续<ArrowRight size={15}/></>}</button>
      </form>
      <small>{session?.environment.origin || '正在读取企业环境'}{session && !session.environment.secure ? ' · HTTP连接' : ''}</small>
      {onImportConnection && <button type="button" className="button" disabled={busy} onClick={() => void importConnection()}>导入组织连接</button>}
      {connection && connection.status !== 'cancelled' && <div role="status">
        <p>Forge：{connection.config.forgeOrigin}<br/>Weave：{connection.config.weaveOrigin}</p>
        <p>{connection.status === 'unchanged' ? '连接文件未变化。' : '组织连接已保存。'}{connection.environmentOverride ? '当前仍使用开发连接覆盖，请管理员处理覆盖后重启。' : connection.restartRequired ? '重启后生效。' : '当前连接地址一致。'}</p>
        {connection.restartRequired && <button type="button" className="button" onClick={() => void onRestartConnection?.().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '重启失败'))}>重启应用</button>}
      </div>}
    </section>
  </main>
}
