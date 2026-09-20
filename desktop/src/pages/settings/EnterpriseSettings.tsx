import { Building2, CircleHelp, Info, LockKeyhole, ShieldCheck, ShieldX, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { PRODUCT_CAPABILITY_IDS } from '@/types/api'
import type { EnterpriseAccountState, PrimeWorkApi, ProductCapabilityDecisionValue, ProductCapabilityId } from '@/types/api'

interface EnterpriseSettingsProps {
  enterprise: PrimeWorkApi['enterprise'] | null
}

const capabilityLabels: Record<ProductCapabilityId, { name: string; detail: string }> = {
  'team.read': { name: '查看团队', detail: '查看已授权团队和已发布定义' },
  'run.read': { name: '查看运行', detail: '查看任务步骤、结果和失败原因' },
  'debug.simulate': { name: '只读模拟', detail: '使用授权数据进行不回写调试' },
  'debug.sandbox_write': { name: '沙箱写入', detail: '只向明确的沙箱环境写入' },
  'release.publish': { name: '发布版本', detail: '发布团队或业务应用版本' },
}

const decisionLabels: Record<ProductCapabilityDecisionValue, string> = { allow: '可使用', deny: '不可使用', unavailable: '待接入' }

export function EnterpriseSettings({ enterprise }: EnterpriseSettingsProps) {
  const [account, setAccount] = useState<EnterpriseAccountState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enterprise) return
    let active = true
    setBusy(true)
    enterprise.getAccount().then((value) => { if (active) setAccount(value) }).catch((reason) => { if (active) setError(errorMessage(reason)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [enterprise])

  const signIn = async () => {
    if (!enterprise || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await enterprise.signIn()
      setAccount(next)
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }

  const signOut = async () => {
    if (!enterprise || busy) return
    setBusy(true)
    setError('')
    try { setAccount(await enterprise.signOut()) } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }

  const signedIn = account?.status === 'signed-in' && account.user
  const capabilities = account?.access?.capabilities ?? PRODUCT_CAPABILITY_IDS.map((id) => ({ id, decision: 'unavailable' as const, reason: '产品权限服务尚未返回判断' }))
  return <>
    <header className="enterprise-settings-header"><span><Building2 size={19}/></span><div><h1>企业账号与权限</h1><p>查看当前身份、组织和产品能力，以及每项能力的判断原因。</p></div></header>
    <section className="settings-group">
      <h2>账号状态</h2>
      {signedIn ? <>
        <div className="settings-row"><span><strong>{account.user?.name}</strong><small>{account.user?.email}</small></span><button type="button" className="button" disabled={busy} onClick={() => { void signOut() }}>{busy ? '正在退出…' : '退出登录'}</button></div>
        <div className="settings-row"><span><strong>所属组织</strong><small>{account.organization?.name ?? '当前账号没有可见组织'}</small></span><Building2 size={15}/></div>
      </> : <div className="enterprise-browser-login"><div><strong>在浏览器中登录</strong><small>将打开企业统一登录页。密码、验证码和单点登录都由身份服务处理。</small></div><button type="button" className="button button--primary" disabled={busy || !enterprise} onClick={() => { void signIn() }}>{busy ? '等待浏览器登录…' : '登录企业账号'}</button></div>}
      {account?.message ? <p className="enterprise-account-note"><Info size={14}/>{account.message}</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
    </section>
    {signedIn ? <section className="settings-group">
      <div className="enterprise-capability-heading"><div><h2>产品能力</h2><p>由接入与权限服务判断。具体业务操作还会由 Forge 再次校验。</p></div><span className={`enterprise-access-state is-${account.access?.status ?? 'unavailable'}`}>{account.access?.status === 'ready' ? '判断已更新' : '权限待接入'}</span></div>
      <div className="enterprise-capability-list">
        {capabilities.map((capability) => {
          const Icon = capability.decision === 'allow' ? ShieldCheck : capability.decision === 'deny' ? ShieldX : CircleHelp
          return <div className={`enterprise-capability is-${capability.decision}`} key={capability.id}>
            <Icon size={16}/><span><strong>{capabilityLabels[capability.id].name}</strong><small>{capabilityLabels[capability.id].detail}</small><em>{capability.reason}</em></span><i>{decisionLabels[capability.decision]}</i>
          </div>
        })}
      </div>
    </section> : null}
    <section className="settings-group">
      <h2>会话保护</h2>
      <div className="info-row"><LockKeyhole size={15}/><div><strong>{account?.storage === 'encrypted' ? (signedIn ? '设备会话已加密保存' : '设备会话将加密保存') : '仅在本次打开期间保留'}</strong><small>Workbench 不接触密码，业务令牌不会显示给页面或智能体。</small></div></div>
      <div className="info-row"><UserRound size={15}/><div><strong>身份、产品能力和业务权限各自负责一层</strong><small>接入服务判断产品能力，Weave 使用短期任务委托，Forge 对具体业务动作做最终判断。</small></div></div>
    </section>
  </>
}
