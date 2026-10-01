// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FlowCanvas, layout, ObjectMenu } from '../../src/pages/team-workspace/TeamCanvas'
import { addParallelBranch, initialGraph } from '../../src/pages/team-workspace/graph'
import { newMember } from '../../src/pages/team-workspace/member'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('lays the flow out top to bottom and keeps parallel branches on one row', () => {
  const first = newMember('deepseek-flash'), second = newMember('deepseek-flash')
  const serial = initialGraph(first)
  const serialPositions = layout(serial).positions
  const ys = serial.nodes.map((node) => serialPositions.get(node.id)!.y)
  expect(ys).toEqual([...ys].sort((a, b) => a - b))
  expect(new Set(serial.nodes.map((node) => serialPositions.get(node.id)!.x)).size).toBe(1)

  const work = serial.nodes.find((node) => node.type === 'worker')!.id
  const parallel = addParallelBranch(serial, work, second).graph
  const { positions, width } = layout(parallel)
  const branches = parallel.nodes.filter((node) => node.type === 'worker')
  expect(branches).toHaveLength(2)
  expect(positions.get(branches[0]!.id)!.y).toBe(positions.get(branches[1]!.id)!.y)
  expect(width).toBeGreaterThan(layout(serial).width)
})

it('selects a step without moving the canvas', async () => {
  const member = newMember('deepseek-flash')
  const flow = { id: 'flow', name: '反馈处理', description: '', trigger_config: {}, graph_definition: initialGraph(member) }
  const onSelect = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<FlowCanvas flow={flow} members={[member]} selected="lead" onSelect={onSelect}/>))
  const nodes = [...container.querySelectorAll<HTMLButtonElement>('.workflow-graph__node')]
  expect(nodes.map((node) => node.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
  await act(async () => nodes[1]!.click())
  expect(onSelect).toHaveBeenCalledWith('work')
  await act(async () => root.unmount())
  container.remove()
})

it('asks for confirmation before running a dangerous menu action', async () => {
  const run = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<ObjectMenu label="步骤" actions={[{ label: '删除步骤', danger: true, confirm: '删除这一步？', run }]}/>))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="步骤操作"]')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(run).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('删除这一步？')
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === '删除步骤')!
  await act(async () => confirm.click())
  expect(run).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  container.remove()
})
