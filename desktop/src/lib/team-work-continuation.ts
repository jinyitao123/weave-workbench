export const TEAM_RECORD_SOURCE_BOUNDARY_NOTE = '业务记录字段只证明系统当前记载了这些值，不自动等于客户确认；没有客户一手材料时，应说“记录载明”或“待核实”。'

export function teamRunContinuationBoundary(createdAt: string): string {
  const timestamp = new Date(createdAt).toLocaleString('zh-CN')
  return `这条工作消息形成于 ${timestamp}，记录的是当时这一次团队运行。Forge 当前业务记录可能已被之后的团队运行或员工操作改变；请把本次运行回执与当前业务状态分别说明，不能仅凭当前值把变化归因于本次动作。\n${TEAM_RECORD_SOURCE_BOUNDARY_NOTE}`
}
