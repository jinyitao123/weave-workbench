import { Bot, GitBranch, GitMerge, CheckCircle2, UsersRound, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui'
import type { TeamDefinition } from '@/types/team-workspace'
import type { EnterpriseWorkflowGraphDefinition as Graph } from '@/types/api'

export const stepTypeLabel = (type: string) => ({ lead: '负责人处理', worker: '成员执行', parallel: '并行分工', join: '汇合', deliver: '交付结果' }[type] || '流程步骤')

const NODE_WIDTH = 160, NODE_HEIGHT = 48, COLUMN = NODE_WIDTH + 16, ROW = NODE_HEIGHT + 36

// Top-to-bottom layers fit a narrow sidebar at full size; parallel branches sit side by side.
export function layout(graph: Graph) {
  const forward = graph.edges.filter((e) => e.route !== 'back')
  const remaining = new Set(graph.nodes.map((n) => n.id)), levels: Graph['nodes'][] = []
  while (remaining.size) {
    let nodes = graph.nodes.filter((n) => remaining.has(n.id) && !forward.some((e) => e.to_node_id === n.id && remaining.has(e.from_node_id)))
    if (!nodes.length) nodes = graph.nodes.filter((n) => remaining.has(n.id)).slice(0, 1)
    levels.push(nodes); nodes.forEach((n) => { remaining.delete(n.id) })
  }
  const columns = Math.max(1, ...levels.map((level) => level.length))
  const width = columns * COLUMN - 16, height = levels.length * ROW - 36
  const positions = new Map<string, { x: number; y: number }>()
  levels.forEach((level, row) => { const indent = (columns - level.length) * COLUMN / 2; level.forEach((node, column) => { positions.set(node.id, { x: indent + column * COLUMN, y: row * ROW }) }) })
  return { width, height, positions }
}

export function FlowCanvas({ flow, members, selected, onSelect }: { flow: TeamDefinition['workflows'][number]; members: TeamDefinition['members']; selected?: string; onSelect(id: string): void }) {
  const graph = flow.graph_definition, { width, height, positions } = layout(graph)
  return <div className="tw-flow" role="region" aria-label="流程画布"><div className="workflow-graph" style={{ width, height }} aria-label="团队流程图">
    <svg width={width} height={height} aria-hidden="true"><defs><marker id="workflow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z"/></marker></defs>{graph.edges.map((edge, i) => {
      const from = positions.get(edge.from_node_id), to = positions.get(edge.to_node_id)
      if (!from || !to) return null
      const back = to.y <= from.y
      const sx = from.x + NODE_WIDTH / 2, sy = from.y + NODE_HEIGHT, ex = to.x + NODE_WIDTH / 2, ey = to.y - 2
      const path = back
        ? `M ${from.x + NODE_WIDTH} ${from.y + NODE_HEIGHT / 2} C ${width + 20} ${from.y + NODE_HEIGHT / 2}, ${width + 20} ${to.y + NODE_HEIGHT / 2}, ${to.x + NODE_WIDTH + 2} ${to.y + NODE_HEIGHT / 2}`
        : `M ${sx} ${sy} C ${sx} ${(sy + ey) / 2}, ${ex} ${(sy + ey) / 2}, ${ex} ${ey}`
      return <path key={edge.id || i} d={path} className={back ? 'is-back' : ''} markerEnd="url(#workflow-arrow)"/>
    })}</svg>
    {graph.nodes.map((node) => {
      const position = positions.get(node.id)!, person = node.type === 'lead' ? members.find((member) => member.configuration.role === 'avatar' && member.relationship.enabled) : members.find((member) => member.id === node.config?.agent_id)
      const Icon = node.type === 'deliver' ? CheckCircle2 : node.type === 'lead' ? UsersRound : node.type === 'parallel' ? GitBranch : node.type === 'join' ? GitMerge : Bot
      const title = node.label || stepTypeLabel(node.type)
      const subtitle = person?.configuration.displayName || stepTypeLabel(node.type)
      return <button type="button" key={node.id} style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }} className={`workflow-graph__node ${selected === node.id ? 'is-selected' : ''}`} aria-label={`编辑步骤 ${title}`} aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}><span><Icon size={15}/></span><span><strong>{title}</strong>{subtitle !== title ? <small>{subtitle}</small> : null}</span></button>
    })}
  </div></div>
}

export type ObjectAction = { label: string; danger?: boolean; confirm?: string; run(): void }

/** Overflow menu for one object; dangerous actions ask for confirmation first. */
export function ObjectMenu({ label, actions }: { label: string; actions: ObjectAction[] }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ObjectAction>()
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); menu.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  if (!actions.length) return null
  return <div className="tw-object-menu" ref={menu}>
    <button type="button" className="tw-edit-icon" aria-label={`${label}操作`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={16}/></button>
    {open && <div className="tw-object-menu-popover" role="menu">{actions.map((action) => <button type="button" role="menuitem" key={action.label} className={action.danger ? 'is-danger' : ''} onClick={() => { setOpen(false); if (action.danger) setPending(action); else action.run() }}>{action.label}</button>)}</div>}
    {pending && <Modal title={pending.label} onClose={() => setPending(undefined)} footer={<><button type="button" className="button" onClick={() => setPending(undefined)}>取消</button><button type="button" className="button button--danger" onClick={() => { const action = pending; setPending(undefined); action.run() }}>{pending.label}</button></>}><p>{pending.confirm ?? `确定要${pending.label}吗？`}</p></Modal>}
  </div>
}
