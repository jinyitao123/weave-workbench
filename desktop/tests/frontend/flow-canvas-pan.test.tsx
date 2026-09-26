// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FlowCanvas } from '../../src/pages/team-workspace/TeamCanvas'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { newMember } from '../../src/pages/team-workspace/member'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

it('moves the workflow canvas freely on both axes without moving nodes when they are clicked', async () => {
  const member = newMember('deepseek-flash')
  const flow = { id: 'flow', name: '反馈处理', description: '', trigger_config: {}, graph_definition: initialGraph(member) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<FlowCanvas flow={flow} members={[member]} selected="lead" onSelect={() => {}} onAdd={() => {}} onBranch={() => {}}/>))
  const region = container.querySelector<HTMLDivElement>('[aria-label="流程画布"]')!
  const graph = container.querySelector<HTMLDivElement>('.tw-graph-size')!
  region.setPointerCapture = vi.fn()
  await act(async () => { region.dispatchEvent(pointer('pointerdown', 100, 100)); region.dispatchEvent(pointer('pointermove', 145, 165)) })
  expect(graph.style.transform).toBe('translate(45px, 65px)')
  await act(async () => { region.dispatchEvent(pointer('pointerup', 145, 165)); region.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })) })
  expect(graph.style.transform).toBe('translate(45px, -15px)')
  const node = container.querySelector<HTMLButtonElement>('.workflow-graph__node')!
  await act(async () => { node.dispatchEvent(pointer('pointerdown', 40, 40)); region.dispatchEvent(pointer('pointermove', 90, 90)) })
  expect(graph.style.transform).toBe('translate(45px, -15px)')
  const fit = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('查看全图'))!
  await act(async () => fit.click())
  expect(graph.style.transform).toBe('translate(0px, 0px)')
  await act(async () => root.unmount())
  container.remove()
})
