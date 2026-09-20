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
      <div className={css.settingsActions}>
        <div><strong>{t('account.logout')}</strong><p>{t('account.logoutHelp')}</p></div>
        <button type="button" className={css.logout} onClick={() => { void logout() }}>{t('account.logout')}</button>
      </div>
    </div>
  </section>
}
