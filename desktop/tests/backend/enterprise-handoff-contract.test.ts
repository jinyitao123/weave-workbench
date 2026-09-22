import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseService } from '../../electron/main/enterprise'

const choice = { teamId: 'team', teamName: '合同团队', workflowId: 'workflow', workflowName: '合同复核', businessCapabilityIds: ['forge:action:forge_sales_contract.contract_submit'], version: 3 }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
async function fixture() {
  const registrations = new Map<string, string>(), heads = new Set<string>(), runs = new Map<string, string>()
  let dropDispatchResponse = false, mismatchDigest = false
  let afterRegistration = async () => {}
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/auth/sign-in/email') return Response.json({ token: 'forge', user: { id: 'employee' } })
    if (path === '/v1/auth/external/exchange') return Response.json({ token: 'weave', subject: { id: 'bound', externalId: 'employee' }, organization: { id: 'org' }, permissions: ['teams:use'] })
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ path, body })
    if (path === '/v1/workbench/dispatch-inputs') {
      // Mirror service admission constraints, not an unconditional success stub.
      expect(String(body.registration_id)).toMatch(uuid)
      expect(Buffer.byteLength(String(body.task))).toBeLessThanOrEqual(1 << 20)
      const sources = body.source_messages as Array<{ event_seq: number; sha256: string; message_id: string }>
      expect(sources.length).toBeGreaterThan(0)
      expect(sources.every((source, i) => /^[a-f0-9]{64}$/.test(source.sha256) && (i === 0 || source.event_seq > sources[i - 1].event_seq))).toBe(true)
      expect(body.authorized_business_capability_ids).toEqual([])
      const id = String(body.registration_id), encoded = JSON.stringify(body)
      if (registrations.has(id) && registrations.get(id) !== encoded) return Response.json({ error: 'input_registration_conflict' }, { status: 409 })
      if (!registrations.has(id) && heads.has(String(body.workbench_session_id))) return Response.json({ error: 'input_revision_conflict' }, { status: 409 })
      registrations.set(id, encoded); heads.add(String(body.workbench_session_id))
      await afterRegistration()
      return Response.json({ input_revision_id: id, client_request_id: id, task_sha256: mismatchDigest ? hash('wrong material') : hash(String(body.task)) }, { status: 201 })
    }
    if (path === '/v1/teams/team/dispatch') {
      const id = String(body.client_request_id), repeated = runs.has(id)
      if (!repeated) runs.set(id, `run-${runs.size + 1}`)
      if (dropDispatchResponse) { dropDispatchResponse = false; throw new Error('response lost after server accepted') }
      return Response.json({ run_id: runs.get(id), task_id: `task-${id}`, workflow_id: 'workflow', workflow_version: 3 }, { status: repeated ? 200 : 201 })
    }
    throw new Error('unexpected request')
  }) as typeof fetch
  const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
  await service.signIn('employee@example.test', 'test')
  let current = true
  const source = { idempotencySeed: 'session:employee-message:team', sessionKey: 'session', sourceMessages: [{ messageId: 'employee-message', eventSeq: 2, sha256: hash('这版给他们看看') }], accountKey: await service.accountKey(), resources: [{ type: 'forge-file' as const, id: 'file-contract-v1', name: '合同.md', bytes: 12, sha256: hash('合同正文') }], authorizedBusinessCapabilityIds: [], assertCurrent: async () => { if (!current) throw new Error('员工已改变要求') } }
  return { service, source, registrations, runs, calls, drop: () => { dropDispatchResponse = true }, wrongDigest: () => { mismatchDigest = true }, changeDuringRegistration: () => { afterRegistration = async () => { current = false } }, logoutDuringRegistration: () => { afterRegistration = async () => { await service.signOut() } } }
}
describe('Weave handoff admission contract', () => {
  it('recovers a lost dispatch response with the identical UUID and body, producing one run', async () => {
    const f = await fixture(); f.drop()
    await expect(f.service.submitWork(choice, '合同正文', f.source)).rejects.toThrow('response lost')
    const receipt = await f.service.submitWork(choice, '合同正文', f.source)
    expect(receipt.repeated).toBe(true)
    expect(f.runs.size).toBe(1)
    const registrations = f.calls.filter((call) => call.path.endsWith('dispatch-inputs'))
    expect(registrations[0].body).toEqual(registrations[1].body)
    expect(receipt.taskSha256).toBe(hash('合同正文'))
  })
  it('keeps a second independent intent in the same desktop conversation from colliding with the prior input head', async () => {
    const f = await fixture()
    await f.service.submitWork(choice, '合同甲', f.source)
    await f.service.submitWork(choice, '合同乙', { ...f.source, idempotencySeed: 'session:second-message:team' })
    expect(f.registrations.size).toBe(2)
  })
  it('does not dispatch after a changed employee request or logout during registration', async () => {
    for (const mode of ['change', 'logout']) {
      const f = await fixture()
      if (mode === 'change') f.changeDuringRegistration(); else f.logoutDuringRegistration()
      await expect(f.service.submitWork(choice, '合同正文', f.source)).rejects.toThrow()
      expect(f.runs.size).toBe(0)
    }
  })
  it('refuses a registration receipt for different material content', async () => {
    const f = await fixture(); f.wrongDigest()
    await expect(f.service.submitWork(choice, '合同正文', f.source)).rejects.toThrow('固定材料不一致')
    expect(f.runs.size).toBe(0)
  })
})
