import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/**
 * Read the visible textual result of a completed tool block.
 * @param block - Tool-call block supplied by the conversation renderer.
 * @returns Joined text and error detail, or null while no result is available.
 */
export function toolResultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n') || null
}
