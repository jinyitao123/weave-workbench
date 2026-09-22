import { useState } from 'react'
import { ProductField, ProductTextArea } from '@/components/ui'

/** Editing changes the in-memory team document; only its Save action persists. */
export function EditableText({ label, value, placeholder, multiline = true, onChange }: { label: string; value: string; placeholder?: string; multiline?: boolean; onChange(value: string): void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <section className="tw-editable is-editing" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false) }}>
    {multiline ? <ProductTextArea autoFocus label={label} value={value} placeholder={placeholder} rows={Math.min(12, Math.max(4, value.split('\n').length + 1))} onChange={(e) => onChange(e.target.value)}/> : <ProductField autoFocus label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false) }}/>}
  </section>
  return <section className="tw-editable"><div className="tw-section-title"><h4>{label}</h4></div><button type="button" className={`tw-readable ${value ? '' : 'is-empty'}`} aria-label={`编辑${label}内容`} onClick={() => setEditing(true)}>{value || placeholder || `补充${label}`}</button></section>
}
