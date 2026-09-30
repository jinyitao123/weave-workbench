import type { EnterpriseWorkContinuationContextView } from '@/types/api'

type Outcomes = NonNullable<Extract<EnterpriseWorkContinuationContextView, { kind: 'weave' }>['actionOutcomes']>

function statusLabel(status: Outcomes[number]['status']): string {
  if (status === 'succeeded') return 'Forge 已确认成功'
  if (status === 'failed') return 'Forge 已确认失败'
  return '结果未知，不能视为成功'
}

export function WorkActionReceipt({ outcomes }: { outcomes?: Outcomes }) {
  return <aside className="work-action-receipt" aria-label="本次业务动作回执">
    <strong>本次业务动作回执</strong>
    {outcomes === undefined
      ? <p>这条工作消息没有附带业务动作回执；团队摘要不能证明业务已提交。</p>
      : outcomes.length === 0
        ? <p>本次没有记录业务动作回执；不能根据团队摘要认定已提交。</p>
        : <ul>{outcomes.map((outcome, index) => <li key={`${outcome.status}:${index}`}>{statusLabel(outcome.status)}</li>)}</ul>}
  </aside>
}
