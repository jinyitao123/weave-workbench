/** Account details shown in the Workbench settings shell. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountProps } from './account-controller.ts'
import css from './AccountAccess.module.css'

type Props = PropsRuntime<'settings.section'> & PropsLocale<'weave'> & AccountProps

export function AccountSettingsSection({ useAccount, logout, t }: Props) {
  const view = useAccount(value => value)
  const user = view.status === 'authenticated' ? view.user : null
  if (user === null) return <section className={css.settingsPage}>
    <h2>{t('account.settingsTitle')}</h2>
    <p className={css.settingsDescription}>{t('account.loading')}</p>
  </section>
  const name = user.display_name || user.username
  const capabilityLabels: Record<string, string> = {
    'team.read': t('account.capability.teamRead'), 'run.read': t('account.capability.runRead'),
    'debug.simulate': t('account.capability.debug'), 'debug.sandbox_write': t('account.capability.sandboxWrite'),
    'release.publish': t('account.capability.publish'),
  }
  return <section className={css.settingsPage}>
    <header>
      <h2>{t('account.settingsTitle')}</h2>
      <p className={css.settingsDescription}>{t('account.settingsDescription')}</p>
    </header>
    <div className={css.settingsCard}>
      <div className={css.settingsIdentity}>
        <span className={css.settingsAvatar} aria-hidden="true">{Array.from(name)[0]}</span>
        <div><strong>{name}</strong><span>{user.username}</span></div>
      </div>
      <dl className={css.settingsFacts}>
        <div><dt>{t('account.workspaceLabel')}</dt><dd>{user.workspace_id === 'default' ? t('account.workspaceDefault') : user.workspace_id}</dd></div>
        <div><dt>{t('account.roleLabel')}</dt><dd>{t(user.role === 'admin' ? 'account.role.admin' : user.role === 'developer' ? 'account.role.developer' : 'account.role.user')}</dd></div>
      </dl>
      <div className={css.accessSection}>
        <div><strong>{t('account.accessTitle')}</strong><span>{user.access?.status === 'ready' ? t('account.accessReady') : t('account.accessUnavailable')}</span></div>
        <ul>{Object.entries(capabilityLabels).map(([id, label]) => {
          const item = user.access?.capabilities.find(capability => capability.id === id)
          return <li key={id}><span>{label}</span><strong data-decision={item?.decision ?? 'unavailable'}>{t(item?.decision === 'allow' ? 'account.accessAllow' : item?.decision === 'deny' ? 'account.accessDeny' : 'account.accessUnknown')}</strong></li>
        })}</ul>
      </div>
      <div className={css.settingsActions}>
        <div><strong>{t('account.logout')}</strong><p>{t('account.logoutHelp')}</p></div>
        <button type="button" className={css.logout} onClick={() => { void logout() }}>{t('account.logout')}</button>
      </div>
    </div>
  </section>
}
