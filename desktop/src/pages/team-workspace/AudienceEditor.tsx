import { useEffect, useState } from 'react'
import { EditableText } from './EditableText'

function parseAudience(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]
}

/**
 * The Forge permission sets that may use the team, one per line. Empty means
 * the whole organization (weave-workbench decision 002). The raw text is kept
 * locally so typing a new line is not undone by normalization.
 */
export function AudienceEditor({ value, onChange }: { value: string[]; onChange(value: string[]): void }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => {
    setText((current) => parseAudience(current).join('\n') === value.join('\n') ? current : value.join('\n'))
  }, [value])
  return <EditableText label="可用人群" placeholder="全组织可用；限定时每行填写一个 Forge 权限集" value={text} onChange={(next) => {
    setText(next)
    onChange(parseAudience(next))
  }}/>
}
