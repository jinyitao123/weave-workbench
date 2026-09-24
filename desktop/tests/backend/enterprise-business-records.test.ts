import { describe, expect, it } from 'vitest'
import { ForgeBusinessReadError, ForgeBusinessReader } from '../../electron/main/enterprise/business-records'

type Field = { name: string; type: string; label: string; reference?: string; required?: boolean }
type ToolCall = { name: string; args: Record<string, unknown> }

const rootFields: Field[] = [
  { name: 'id', type: 'text', label: 'ID' },
  { name: 'name', type: 'text', label: '报价名称' },
  { name: 'code', type: 'text', label: '报价编号' },
  { name: 'status', type: 'select', label: '状态' },
  { name: 'owner_name', type: 'text', label: '负责人' },
  { name: 'item_count', type: 'number', label: '明细行数' },
  { name: 'version', type: 'number', label: '版本' },
  { name: 'customer_id', type: 'lookup', label: '客户', reference: 'customer' },
  { name: 'access_token', type: 'secret', label: '访问令牌' },
]

const lineFields: Field[] = [
  { name: 'id', type: 'text', label: 'ID' },
  { name: 'quote_id', type: 'lookup', label: '销售报价', reference: 'sales_quote' },
  { name: 'item_name', type: 'text', label: '明细名称' },
  { name: 'quantity', type: 'number', label: '数量' },
  { name: 'unit_price', type: 'currency', label: '单价' },
  { name: 'line_amount', type: 'currency', label: '金额' },
]

function metadata(objectName: string, label: string, fields: Field[]) {
  return { type: 'object', name: objectName, sortability: [], item: { name: objectName, label, fields } }
}

function readerFixture(options: { lineCount?: number; deniedLineQuery?: boolean; denyParentRead?: boolean; hideSearchFields?: boolean } = {}) {
  const calls: ToolCall[] = []
  const metadataCalls: string[] = []
  const directory = {
    objects: [
      { name: 'sales_quote', label: '销售报价', fieldCount: rootFields.length },
      { name: 'sales_quote_line', label: '销售报价明细', fieldCount: lineFields.length },
      { name: 'customer', label: '客户', fieldCount: 4 },
    ],
    totalCount: 3,
  }
  const reader = new ForgeBusinessReader(async (name, args) => {
    calls.push({ name, args })
    if (name === 'list_objects') return directory
    if (name === 'describe_object') {
      return { name: 'sales_quote', label: '销售报价', fields: rootFields, enableFeatures: [] }
    }
    if (name === 'get_record') {
      if (args.objectName === 'sales_quote') return {
        id: 'quote-internal-1', name: '设备交接报价', code: 'Q-240', status: '草稿', owner_name: '销售小李', item_count: 2, version: 7, customer_id: 'customer-internal-1', access_token: 'do-not-expose',
      }
      if (args.objectName === 'customer') {
        if (options.denyParentRead) throw new ForgeBusinessReadError('forbidden', 'permission denied')
        return { id: 'customer-internal-1', name: '北辰设备客户', email: 'private@example.test' }
      }
      throw new ForgeBusinessReadError('forbidden', 'permission denied')
    }
    if (name === 'query_records') {
      if (args.objectName === 'sales_quote') return {
        object: 'sales_quote', records: [options.hideSearchFields ? { id: 'quote-internal-1' } : {
          id: 'quote-internal-1', name: '设备交接报价', code: 'Q-240', status: '草稿', owner_name: '销售小李', item_count: 2, version: 7,
        }], total: 1, hasMore: false,
      }
      if (options.deniedLineQuery) throw new ForgeBusinessReadError('forbidden', 'permission denied')
      const count = options.lineCount ?? 2
      return {
        object: 'sales_quote_line',
        records: Array.from({ length: count }, (_, index) => ({
          id: `line-${index + 1}`, quote_id: 'quote-internal-1', item_name: `设备 ${index + 1}`, quantity: index + 1, unit_price: 100, line_amount: 100 * (index + 1),
        })),
        total: count,
        hasMore: false,
      }
    }
    throw new Error(`unexpected tool ${name}`)
  }, async (objectName) => {
    metadataCalls.push(objectName)
    if (objectName === 'sales_quote') return metadata(objectName, '销售报价', rootFields)
    if (objectName === 'sales_quote_line') return metadata(objectName, '销售报价明细', lineFields)
    if (objectName === 'customer') return metadata(objectName, '客户', [
      { name: 'id', type: 'text', label: 'ID' }, { name: 'name', type: 'text', label: '客户名称' }, { name: 'email', type: 'email', label: '邮箱' },
    ])
    throw new ForgeBusinessReadError('not_found', 'metadata missing')
  })
  return { reader, calls, metadataCalls }
}

describe('native Forge business record reads', () => {
  it('does not expose a native owner user ID as a person name', async () => {
    const requested: Record<string, unknown>[] = []
    const fields = [
      { name: 'id', type: 'text', label: 'ID' },
      { name: 'name', type: 'text', label: '名称' },
      { name: 'responsible_id', type: 'user', label: '负责人' },
    ]
    const reader = new ForgeBusinessReader(async (name, args) => {
      if (name === 'list_objects') return { objects: [{ name: 'sales_lead', label: '销售线索' }], totalCount: 1 }
      if (name === 'describe_object') return { name: 'sales_lead', label: '销售线索', fields }
      if (name === 'query_records') {
        requested.push(args)
        return { object: 'sales_lead', records: [{ id: 'lead-1', name: '青峦工业视觉检测改造', responsible_id: 'opaque-native-user-id' }], total: 1, hasMore: false }
      }
      throw new Error('unexpected tool')
    }, async () => ({ name: 'sales_lead', label: '销售线索', fields }))
    const page = await reader.findRecords('sales_lead', '青峦工业视觉检测改造', 0, 20, 1)
    expect(page.records).toMatchObject([{ name: '青峦工业视觉检测改造' }])
    expect(page.records[0]).not.toHaveProperty('owner')
    expect(requested[0].fields).not.toContain('responsible_id')
  })

  it('uses only the selected object and one native query page for search', async () => {
    const f = readerFixture()
    const page = await f.reader.findRecords('sales_quote', '采购订单 Q-999', 20, 10, 1)
    expect(page).toMatchObject({ offset: 20, limit: 10, hasMore: false, complete: true, records: [] })
    expect(f.calls.filter((call) => call.name === 'query_records')).toEqual([{
      name: 'query_records', args: expect.objectContaining({ objectName: 'sales_quote', offset: 20, limit: 10 }),
    }])
    expect(f.calls.filter((call) => call.name === 'query_records').every((call) => call.args.objectName !== 'customer')).toBe(true)
  })

  it('does not report no matches when RLS/FLS omits every searchable display field', async () => {
    const f = readerFixture({ hideSearchFields: true })
    const page = await f.reader.findRecords('sales_quote', 'Q-240', 0, 20, 1)
    expect(page).toMatchObject({ records: [], complete: false, warning: expect.stringContaining('可读字段不足') })
  })

  it('returns the employee-readable state, owner and native record version with the opaque selection context', async () => {
    const f = readerFixture()
    const page = await f.reader.findRecords('sales_quote', 'Q-240 设备交接报价', 0, 20, 1)
    expect(page.records).toMatchObject([{ name: '设备交接报价', code: 'Q-240', status: '草稿', owner: '销售小李', recordVersion: '7' }])
    const query = f.calls.find((call) => call.name === 'query_records')!
    expect(query.args.fields).toEqual(expect.arrayContaining(['status', 'owner_name', 'version']))
  })

  it('confirms a related detail object from native metadata and compares the full row count with item_count', async () => {
    const f = readerFixture()
    const read = await f.reader.readRecord('sales_quote', 'quote-internal-1', 1)
    expect(read.snapshot).toMatchObject({
      completeness: 'partial',
      pricingDetailCompleteness: 'complete',
      expectedDetailCount: 2,
    })
    expect(read.snapshot.relations).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'related', returnedCount: 2, expectedCount: 2, requiredForCalculation: true, complete: true })]))
    expect(f.metadataCalls).toEqual(['sales_quote', 'sales_quote_line', 'customer'])
    expect(f.calls.find((call) => call.name === 'query_records' && call.args.objectName === 'sales_quote_line')?.args.where).toEqual({ quote_id: 'quote-internal-1' })
    expect(f.calls.some((call) => call.name === 'query_records' && call.args.objectName === 'customer')).toBe(false)
    expect(JSON.stringify(read.snapshot)).not.toContain('quote-internal-1')
    expect(JSON.stringify(read.snapshot)).not.toContain('customer-internal-1')
    expect(JSON.stringify(read.snapshot)).not.toContain('private@example.test')
    expect(JSON.stringify(read.snapshot)).not.toContain('do-not-expose')
    expect(JSON.stringify(read.snapshot)).toContain('设备 2')
  })

  it('marks a declared item-count mismatch as blocking incomplete detail data', async () => {
    const f = readerFixture({ lineCount: 1 })
    const read = await f.reader.readRecord('sales_quote', 'quote-internal-1', 1)
    expect(read.snapshot).toMatchObject({ completeness: 'incomplete', pricingDetailCompleteness: 'incomplete', expectedDetailCount: 2 })
    expect(read.snapshot.completenessNotes.join(' ')).toContain('停止按完整明细核算')
    expect(read.snapshot.relations[0]).toMatchObject({ returnedCount: 1, expectedCount: 2, complete: false })
  })

  it('keeps the selected record while reporting a child query denial as incomplete detail data', async () => {
    const f = readerFixture({ deniedLineQuery: true })
    const read = await f.reader.readRecord('sales_quote', 'quote-internal-1', 1)
    expect(read.snapshot).toMatchObject({ completeness: 'incomplete', pricingDetailCompleteness: 'incomplete' })
    expect(read.snapshot.relations.find((relation) => relation.direction === 'related')).toMatchObject({ returnedCount: 0, requiredForCalculation: true, complete: false })
    expect(read.candidate.name).toBe('设备交接报价')
  })

  it('keeps the selected record while reporting an unreadable native parent relation as partial', async () => {
    const f = readerFixture({ denyParentRead: true })
    const read = await f.reader.readRecord('sales_quote', 'quote-internal-1', 1)
    expect(read.snapshot.completeness).toBe('partial')
    expect(read.snapshot.pricingDetailCompleteness).toBe('complete')
    expect(read.snapshot.relations).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'reference', returnedCount: 0, complete: false })]))
  })
})
