import type { EmployeeBusinessContext, EmployeeBusinessOperation, EmployeeBusinessParameter, EmployeeBusinessRecord, EmployeeBusinessRequest, EmployeeBusinessValue } from '../../../src/types/employee-business'
import { rejectUnknownKeys, requireRecord, requireString } from '../validation'
import { digest } from './handoff-store'

const sha = /^[0-9a-f]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const name = /^[a-z][a-z0-9_]{0,127}$/
const reserved = /^(?:action_?name|object_?name|record_?id|actor_?id|user_?id|organization_?id|context_?(?:id|version)|source(?:_.*)?|op_?key|idempotency_?key|employee_?message|file_?id|record_?version)$/i
function text(value: unknown, max = 128): string { return requireString(value, '业务动作字段', { min: 1, max, trim: false }) }
function check(ok: unknown): asserts ok { if (!ok) throw new Error('个人业务动作声明或回执无效，请重新读取当前事项') }
function scalar(value: unknown): value is EmployeeBusinessValue { return typeof value === 'string' && value.length <= 4000 || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) }
function recordReference(value: unknown): EmployeeBusinessRecord {
  const r = requireRecord(value, 'record'); rejectUnknownKeys(r, ['objectName', 'recordId', 'label'], 'record')
  check(name.test(text(r.objectName)) && !String(r.objectName).startsWith('sys_'))
  return { objectName: String(r.objectName), recordId: text(r.recordId), label: text(r.label, 300) }
}
function parameter(value: unknown): EmployeeBusinessParameter {
  const p = requireRecord(value, 'parameter')
  rejectUnknownKeys(p, ['name', 'label', 'type', 'required', 'description', 'enum', 'enumLabels', 'minimum', 'maximum', 'maxLength'], 'parameter')
  check(name.test(text(p.name)) && !reserved.test(String(p.name)) && ['string', 'number', 'boolean', 'date', 'file'].includes(String(p.type)) && typeof p.required === 'boolean')
  text(p.label, 160)
  if (p.description !== undefined) check(typeof p.description === 'string' && p.description.length <= 1000)
  if (p.enum !== undefined) check(Array.isArray(p.enum) && p.enum.length > 0 && p.enum.length <= 100 && p.enum.every(scalar) && new Set(p.enum).size === p.enum.length)
  if (p.enumLabels !== undefined) {
    check(Array.isArray(p.enum) && Array.isArray(p.enumLabels) && p.enumLabels.length === p.enum.length)
    const mapped = new Set<EmployeeBusinessValue>()
    for (const value of p.enumLabels) {
      const entry = requireRecord(value, 'enum label'); rejectUnknownKeys(entry, ['value', 'label'], 'enum label')
      check(scalar(entry.value) && p.enum.includes(entry.value) && !mapped.has(entry.value))
      check(text(entry.label, 160).trim().length > 0); mapped.add(entry.value)
    }
  }
  for (const key of ['minimum', 'maximum']) if (p[key] !== undefined) check(typeof p[key] === 'number' && Number.isFinite(p[key]))
  if (p.maxLength !== undefined) check(Number.isInteger(p.maxLength) && Number(p.maxLength) > 0 && Number(p.maxLength) <= 4000)
  return p as unknown as EmployeeBusinessParameter
}
export function parseEmployeeBusinessContext(value: unknown): EmployeeBusinessContext {
  const c = requireRecord(value, 'context')
  rejectUnknownKeys(c, ['version', 'contextId', 'contextVersion', 'recordVersion', 'expiresAt', 'readOnly', 'record', 'source', 'actions'], 'context')
  check(c.version === '1' && c.readOnly === true && uuid.test(text(c.contextId)) && sha.test(text(c.contextVersion)))
  text(c.recordVersion); check(typeof c.expiresAt === 'string' && Number.isFinite(Date.parse(c.expiresAt)))
  const source = requireRecord(c.source, 'source'); rejectUnknownKeys(source, ['kind', 'reference'], 'source')
  check(['record', 'business_notification', 'approval'].includes(String(source.kind)))
  if (source.kind === 'record') check(source.reference === undefined); else text(source.reference)
  const record = recordReference(c.record)
  check(Array.isArray(c.actions) && c.actions.length <= 64)
  const refs = new Set<number>()
  const actions = c.actions.map((value) => {
    const a = requireRecord(value, 'action')
    rejectUnknownKeys(a, ['action_ref', 'capabilityId', 'declarationVersion', 'label', 'description', 'effect', 'executionMode', 'parameters'], 'action')
    check(Number.isInteger(a.action_ref) && Number(a.action_ref) >= 1 && Number(a.action_ref) <= 64 && !refs.has(Number(a.action_ref)))
    refs.add(Number(a.action_ref)); text(a.capabilityId, 160); text(a.label, 160); text(a.description, 1000)
    check(sha.test(text(a.declarationVersion)) && a.executionMode === 'employee_only' && ['read', 'write'].includes(String(a.effect)))
    check(Array.isArray(a.parameters) && a.parameters.length <= 32)
    const parameters = a.parameters.map(parameter)
    check(new Set(parameters.map((p) => p.name)).size === parameters.length && parameters.filter((p) => p.type === 'file').length <= 1)
    return { ...a, parameters }
  })
  return { ...c, record, source, actions } as unknown as EmployeeBusinessContext
}
export function parseEmployeeBusinessOperation(value: unknown): EmployeeBusinessOperation {
  const o = requireRecord(value, 'operation')
  rejectUnknownKeys(o, ['version', 'operationId', 'contextId', 'requestDigest', 'status', 'repeated', 'updatedAt', 'noEffect', 'code', 'summary', 'recordReferences'], 'operation')
  check(o.version === '1' && uuid.test(text(o.operationId)) && uuid.test(text(o.contextId)) && sha.test(text(o.requestDigest)))
  check(['in_progress', 'succeeded', 'failed', 'unknown'].includes(String(o.status)) && typeof o.repeated === 'boolean' && Number.isFinite(Date.parse(text(o.updatedAt))))
  if (o.noEffect !== undefined) check(typeof o.noEffect === 'boolean')
  if (o.status === 'unknown' || o.status === 'in_progress') check(o.noEffect !== true)
  if (o.code !== undefined) check(/^[A-Z][A-Z0-9_]{0,95}$/.test(String(o.code)))
  if (o.summary !== undefined) check(typeof o.summary === 'string' && o.summary.length <= 1000)
  if (o.recordReferences !== undefined) {
    check(o.status === 'succeeded' && Array.isArray(o.recordReferences) && o.recordReferences.length <= 16)
    o.recordReferences = o.recordReferences.map(recordReference)
  }
  return o as unknown as EmployeeBusinessOperation
}
export function canonicalBusinessJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalBusinessJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalBusinessJSON((value as Record<string, unknown>)[k])}`).join(',')}}`
  throw new Error('业务请求包含不可序列化的值')
}
export function employeeBusinessRequestDigest(request: EmployeeBusinessRequest): string { return digest(canonicalBusinessJSON({ ...request, file: request.file ?? null })) }
export function validateEmployeeBusinessValues(parameters: EmployeeBusinessParameter[], raw: unknown): Record<string, EmployeeBusinessValue> {
  const values = requireRecord(raw, 'values'); const declared = parameters.filter((p) => p.type !== 'file')
  rejectUnknownKeys(values, declared.map((p) => p.name), 'values')
  for (const p of declared) {
    const value = values[p.name]
    if (value === undefined) { check(!p.required); continue }
    check(scalar(value) && !reserved.test(p.name))
    check(p.type === 'number' ? typeof value === 'number' : p.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string')
    if (typeof value === 'string') check(!value.includes('\0') && value.length <= (p.maxLength ?? 4000) && (!p.required || value.trim().length > 0))
    if (p.type === 'date') check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
    if (p.enum) check(p.enum.includes(value))
    if (typeof value === 'number') check((p.minimum === undefined || value >= p.minimum) && (p.maximum === undefined || value <= p.maximum))
  }
  return values as Record<string, EmployeeBusinessValue>
}
