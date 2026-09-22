import { Bot, GitBranch, GitMerge, CheckCircle2, UsersRound, MoreHorizontal, Minus, Plus, Maximize } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { TeamDefinition } from '@/types/team-workspace'
import type { EnterpriseWorkflowGraphDefinition as Graph } from '@/types/api'

const typeLabel = (type: string) => ({ lead: '负责人处理', worker: '成员执行', parallel: '并行分工', join: '汇合', deliver: '交付结果' }[type] || '流程步骤')
// Preserve the original workspace graph's compact nodes, spacing and edge paths.
function layout(graph: Graph) {
  const forward = graph.edges.filter((e) => e.route !== 'back')
  const remaining = new Set(graph.nodes.map((n) => n.id)), levels: Graph['nodes'][] = []
  while (remaining.size) {
    let nodes = graph.nodes.filter((n) => remaining.has(n.id) && !forward.some((e) => e.to_node_id === n.id && remaining.has(e.from_node_id)))
    if (!nodes.length) nodes = graph.nodes.filter((n) => remaining.has(n.id)).slice(0, 1)
    levels.push(nodes); nodes.forEach((n) => { remaining.delete(n.id) })
  }
  const width = Math.max(430, levels.length * 150 - 20)
  const height = Math.max(240, Math.max(1, ...levels.map((l) => l.length)) * 82 + 54)
  const positions = new Map<string, { x: number; y: number }>()
  levels.forEach((level, column) => { level.forEach((node, row) => { positions.set(node.id, { x: column * 150, y: height / 2 - ((level.length - 1) * 82) / 2 + row * 82 - 26 }) }) })
  return { width, height, positions }
}
export function FlowCanvas({ flow, members, selected, onSelect, onAdd, onBranch }: { flow: TeamDefinition['workflows'][number]; members: TeamDefinition['members']; selected?: string; onSelect(id: string): void; onAdd(): void; onBranch(): void }) {
  const viewport = useRef<HTMLDivElement>(null), pan = useRef<{ x: number; left: number } | null>(null)
  const [available, setAvailable] = useState(0), [zoom, setZoom] = useState<number | null>(1)
  const graph = flow.graph_definition, { width, height, positions } = layout(graph)
  const scale = zoom ?? (available ? Math.min(1, (available - 24) / width) : 1)
  useEffect(() => {
    const element = viewport.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth))
    observer.observe(element); return () => observer.disconnect()
  }, [])
  return <div className="tw-original-canvas"><div ref={viewport} className="workflow-graph-scroll" tabIndex={0} role="region" aria-label="流程画布" onPointerDown={(event) => { if (event.button !== 0 || (event.target as Element).closest('button')) return; pan.current = { x: event.clientX, left: event.currentTarget.scrollLeft }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (pan.current) event.currentTarget.scrollLeft = pan.current.left - event.clientX + pan.current.x }} onPointerUp={() => { pan.current = null }} onPointerCancel={() => { pan.current = null }} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 150 : -150 }); event.preventDefault() } }}>
    <div className="tw-graph-size" style={{ width: width * scale, height: height * scale }}><div className="workflow-graph" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} aria-label="团队流程图">
      <svg width={width} height={height} aria-hidden="true"><defs><marker id="workflow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z"/></marker></defs>{graph.edges.map((edge, i) => {
        const from = positions.get(edge.from_node_id), to = positions.get(edge.to_node_id)
        if (!from || !to) return null
        const sx = from.x + 122, sy = from.y + 26, ex = to.x - 2, ey = to.y + 26, back = ex <= sx
        const path = back ? `M ${sx} ${sy} C ${sx + 34} ${height - 10}, ${Math.max(8, ex - 34)} ${height - 10}, ${ex} ${ey}` : `M ${sx} ${sy} C ${(sx + ex) / 2} ${sy}, ${(sx + ex) / 2} ${ey}, ${ex} ${ey}`
        return <path key={edge.id || i} d={path} className={back ? 'is-back' : ''} markerEnd="url(#workflow-arrow)"/>
      })}</svg>
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)!, person = members.find((m) => m.id === node.config?.agent_id)
        const Icon = node.type === 'deliver' ? CheckCircle2 : node.type === 'lead' ? UsersRound : node.type === 'parallel' ? GitBranch : node.type === 'join' ? GitMerge : Bot
        const canAddNext = node.type === 'parallel' || (['lead', 'worker', 'join'].includes(node.type) && graph.edges.filter((e) => e.from_node_id === node.id).length === 1)
        return <Fragment key={node.id}><button type="button" style={{ left: position.x, top: position.y }} className={`workflow-graph__node ${selected === node.id ? 'is-selected' : ''}`} aria-label={`编辑步骤 ${node.label || typeLabel(node.type)}`} aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}><span><Icon size={15}/></span><span><strong>{node.label || typeLabel(node.type)}</strong><small>{person?.configuration.displayName || typeLabel(node.type)}</small></span></button>{selected === node.id && <div className="tw-node-actions" style={{ left: position.x, top: position.y + 60 }}>{canAddNext && <button type="button" onClick={onAdd}><Plus size={10}/>下一步</button>}{['worker', 'parallel'].includes(node.type) && <button type="button" onClick={onBranch}><GitBranch size={10}/>并行分支</button>}</div>}</Fragment>
      })}
    </div></div>
    </div><div className="tw-canvas-controls"><small className="tw-pan-help">拖动画布查看后续步骤</small><button type="button" aria-label="缩小流程图" onClick={() => setZoom(Math.max(.3, scale - .1))}><Minus size={13}/></button><span>{Math.round(scale * 100)}%</span><button type="button" aria-label="放大流程图" onClick={() => setZoom(Math.min(1.5, scale + .1))}><Plus size={13}/></button><button type="button" onClick={() => { setZoom(null); viewport.current?.scrollTo({ left: 0 }) }}><Maximize size={13}/>查看全图</button></div>
  </div>
}
export function ObjectMenu({ label, actions }: { label: string; actions: Array<{ label: string; danger?: boolean; run(): void }> }) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); menu.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  return <div className="tw-object-menu" ref={menu}><button type="button" className="tw-edit-icon" aria-label={`${label}操作`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={18}/></button>{open && <div className="tw-object-menu-popover">{actions.map((action) => <button type="button" key={action.label} className={action.danger ? 'is-danger' : ''} onClick={() => { setOpen(false); action.run() }}>{action.label}</button>)}</div>}</div>
}
