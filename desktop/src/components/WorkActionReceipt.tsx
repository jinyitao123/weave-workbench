import type { EnterpriseWorkContinuationContextView } from '@/types/api'

type Outcomes = NonNullable<Extract<EnterpriseWorkContinuationContextView, { kind: 'weave' }>['actionOutcomes']>

function actionLabel(outcome: Outcomes[number]): string {
  const quoted = /业务动作“([^”]{1,128})”/.exec(outcome.summary)?.[1]
  if (!quoted || !/[\u4e00-\u9fff]/.test(quoted) || quoted.includes('/') || quoted.includes('\\') || /[0-9a-f]{8}-[0-9a-f-]{27,}|\b[0-9a-f]{24,}\b/i.test(quoted)) return '业务工具调用'
  return quoted
}

function statusLabel(outcome: Outcomes[number]): string {
  const label = actionLabel(outcome)
  if (outcome.status === 'succeeded') return `${label}：工具调用返回成功`
  if (outcome.status === 'failed') return `${label}：工具调用返回失败`
  return `${label}：调用结果未知，需核对业务记录`
}

export function WorkActionReceipt({ outcomes }: { outcomes?: Outcomes }) {
  return <aside className="work-action-receipt" aria-label="本次业务动作回执">
    <strong>本次业务动作回执</strong>
    {outcomes === undefined
      ? <p>未取得业务动作回执；不能根据团队摘要认定已提交。</p>
      : outcomes.length === 0
        ? <p>平台记录本次调用次数为 0；不能根据团队摘要认定已提交。</p>
        : <ul>{outcomes.map((outcome, index) => <li key={`${outcome.status}:${index}`}>{statusLabel(outcome)}</li>)}</ul>}
  </aside>
}
