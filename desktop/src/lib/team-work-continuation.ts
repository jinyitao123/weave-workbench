import type { EnterpriseWorkContinuationContextView } from '@/types/api'

export const TEAM_RECORD_SOURCE_BOUNDARY_NOTE = '业务记录字段只证明系统当前记载了这些值，不自动等于客户确认；没有客户一手材料时，应说“记录载明”或“待核实”。'

export function teamRunContinuationBoundary(createdAt: string): string {
  const timestamp = new Date(createdAt).toLocaleString('zh-CN')
  return `这条工作消息形成于 ${timestamp}，记录的是当时这一次团队运行。Forge 当前业务记录可能已被之后的团队运行或员工操作改变；请把本次运行回执与当前业务状态分别说明，不能仅凭当前值把变化归因于本次动作。\n${TEAM_RECORD_SOURCE_BOUNDARY_NOTE}`
}

type TeamContext = Extract<EnterpriseWorkContinuationContextView, { kind: 'weave' }>

export function teamContinuationResultNotice(
  runStatus: TeamContext['runStatus'] | undefined, finalResult: TeamContext['finalResult'], actionOutcomes: TeamContext['actionOutcomes'],
): string {
  if (finalResult?.disposition === 'needs_input') {
    const hasSucceededAction = runStatus === 'succeeded' && actionOutcomes?.some((outcome) => outcome.status === 'succeeded')
    return [
      hasSucceededAction
        ? 'Weave 本轮结构化结果列出的缺项是团队意见，供员工参考。本运行已有 Forge 确认成功的业务动作，这些意见不构成团队补材料待办，也不要求重跑团队；后续办理事项以 Forge 当前正式事项为准。'
        : 'Weave 本轮结构化结果分类：需要员工补充。此分类来自已核验的原工作上下文，不是从通知文案推断。',
      finalResult.summary ? `团队摘要：${finalResult.summary}` : '',
      `${hasSucceededAction ? '团队列出的缺项意见（供参考）' : '本轮需要补充的内容'}：${finalResult.missingItems?.length ? finalResult.missingItems.map((entry) => `- ${entry}`).join('\n') : '平台没有提供具体缺项。'}`,
    ].filter(Boolean).join('\n')
  }
  if (finalResult?.disposition === 'complete') {
    return `Weave 本轮结构化结果分类：团队检查已完成。该分类只表示团队检查结果，不表示 Forge 业务已完成。${finalResult.summary ? `\n团队摘要：${finalResult.summary}` : ''}`
  }
  return ''
}
