import { useState } from 'react'
import type { EnterpriseTaskScopeDisplay, EnterpriseWorkCancellationResult, MessagePart, TranscriptMessage } from '@/types/api'

const hostTools = new Set(['gooeypi_enterprise_work_submit', 'gooeypi_enterprise_work_recover'])
const internalID = /[0-9a-f]{8}-[0-9a-f-]{27,}|^forge:action:/i
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const label = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 300 && !internalID.test(value)

function scopeReceipt(part: MessagePart, toolName?: string): EnterpriseTaskScopeDisplay | undefined {
  if (part.type !== 'toolResult' || part.isError || part.streaming || !hostTools.has(toolName ?? part.name ?? '') || part.text.length > 200_000) return undefined
  try {
    const result = record(JSON.parse(part.text)), scope = record(result?.scope_display), receipt = record(result?.receipt)
    if (result?.status !== 'accepted' || scope?.version !== '1' || scope.source !== 'workbench-host'
      || typeof scope.runReference !== 'string' || !scope.runReference || scope.runReference.length > 128
      || receipt?.runId !== scope.runReference || !label(scope.team) || !label(scope.workflow)
      || !Array.isArray(scope.reads) || scope.reads.length < 1 || scope.reads.length > 128 || !scope.reads.every(label)
      || !Array.isArray(scope.writes) || scope.writes.length > 32 || !scope.writes.every(label)) return undefined
    return scope as unknown as EnterpriseTaskScopeDisplay
  } catch { return undefined }
}

/** Only native Host tool receipts become cards; narrative JSON cannot create an authorization display. */
export function enterpriseScopeProjection(message: TranscriptMessage): { message: TranscriptMessage; scopes: EnterpriseTaskScopeDisplay[] } {
  const scopes = new Map<string, EnterpriseTaskScopeDisplay>(), hidden = new Set<number>()
  message.parts.forEach((part, index) => {
    const previous = message.parts[index - 1]
    const scope = scopeReceipt(part, previous?.type === 'toolCall' ? previous.name : undefined)
    if (!scope) return
    scopes.set(scope.runReference, scope); hidden.add(index)
    if (previous?.type === 'toolCall' && hostTools.has(previous.name)) hidden.add(index - 1)
  })
  return { message: hidden.size ? { ...message, parts: message.parts.filter((_part, index) => !hidden.has(index)) } : message, scopes: [...scopes.values()] }
}

export function EnterpriseScopeCards({ scopes, onCancelWork }: {
  scopes: EnterpriseTaskScopeDisplay[]
  onCancelWork?(runId: string): Promise<EnterpriseWorkCancellationResult>
}) {
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, EnterpriseWorkCancellationResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  if (!scopes.length) return null
  return <div className="enterprise-scope-cards">{scopes.map((scope) => {
    const result = results[scope.runReference]
    const ended = result?.status === 'cancelled' || result?.status === 'completed'
    return <section className="enterprise-scope-card" aria-label="本次团队授权" key={scope.runReference}>
      <header><strong>{scope.team} · {scope.workflow}</strong><span>已接单</span></header>
      <dl><div><dt>可查看</dt><dd>{scope.reads.join('、')}</dd></div><div><dt>可写入</dt><dd>{scope.writes.length ? scope.writes.join('、') : '只读分析'}</dd></div></dl>
      {onCancelWork ? <button type="button" className="button" disabled={busy === scope.runReference || ended} onClick={() => {
        setBusy(scope.runReference); setErrors((current) => ({ ...current, [scope.runReference]: '' }))
        void onCancelWork(scope.runReference).then((value) => setResults((current) => ({ ...current, [scope.runReference]: value })))
          .catch((error) => setErrors((current) => ({ ...current, [scope.runReference]: error instanceof Error ? error.message : '取消结果待核对' })))
          .finally(() => setBusy(''))
      }}>{busy === scope.runReference ? '正在核对…' : result?.status === 'cancelled' ? '已取消' : result?.status === 'completed' ? '工作已结束' : result ? '核对取消' : '取消工作'}</button> : null}
      {result ? <p role="status">{result.message}</p> : null}
      {errors[scope.runReference] ? <p role="alert">{errors[scope.runReference]}</p> : null}
    </section>
  })}</div>
}
