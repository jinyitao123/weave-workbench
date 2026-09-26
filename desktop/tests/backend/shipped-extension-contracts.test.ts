import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI } from 'prime-agent'
import { EXTENSION_INJECTIONS, SHIPPED_EXTENSION_FILENAMES, type ExtensionInjection } from '../../electron/main/extension-manifest'
import type { OmpExtensionApi } from '../../assets/extensions/omp-work-browser'
import type { PiFastModeExtensionApi } from '../../assets/extensions/pi-work-fast-mode'

type Registration = { kind: 'tool' | 'command' | 'event'; name: string }

interface Fixture {
  api: object
  registrations: Registration[]
  tools?: unknown[]
  handlers?: Map<string, (event: { prompt: string }) => Promise<void>>
}

type PrimeFixtureApi = Pick<ExtensionAPI, 'registerTool' | 'on'>
type PiFixtureApi = PiFastModeExtensionApi & Omit<OmpExtensionApi, 'typebox'>

function primeHost(): Fixture {
  const registrations: Registration[] = []
  const target: PrimeFixtureApi = {
    on: (event) => { registrations.push({ kind: 'event', name: event }) },
    registerTool: (tool) => { registrations.push({ kind: 'tool', name: tool.name }) },
  }
  const api = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'constructor') return Reflect.get(object, property, receiver)
      // Model the absent optional shim that shipped files probe before using their dynamic-import fallback.
      if (property === 'typebox') return undefined
      if (!(property in object)) throw new Error(`Prime fixture does not inject ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  return { api, registrations }
}

function ompHost(): Fixture {
  const registrations: Registration[] = []
  const schema = (kind: string) => (...args: unknown[]) => ({ kind, args })
  const target: OmpExtensionApi & { on(event: string, handler: unknown): void } = {
    on: (event) => { registrations.push({ kind: 'event', name: event }) },
    typebox: {
      Type: {
        Object: schema('object'),
        String: schema('string'),
        Number: schema('number'),
        Boolean: schema('boolean'),
        Array: schema('array'),
        Enum: schema('enum'),
        Optional: schema('optional'),
      },
    },
    registerTool: (tool) => { registrations.push({ kind: 'tool', name: tool.name }) },
  }
  const api = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'constructor') return Reflect.get(object, property, receiver)
      if (!(property in object)) throw new Error(`OMP fixture does not inject ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  return { api, registrations }
}

function piHost(): Fixture {
  const registrations: Registration[] = []
  const tools: unknown[] = []
  const handlers = new Map<string, (event: { prompt: string }) => Promise<void>>()
  const target: PiFixtureApi = {
    registerTool: (tool) => { registrations.push({ kind: 'tool', name: tool.name }); tools.push(tool) },
    registerCommand: (name: string) => { registrations.push({ kind: 'command', name }) },
    on: (event: string, handler: unknown) => {
      registrations.push({ kind: 'event', name: event })
      handlers.set(event, handler as (event: { prompt: string }) => Promise<void>)
    },
  }
  const api = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'constructor') return Reflect.get(object, property, receiver)
      // Model the absent optional shim that shipped files probe before using their dynamic-import fallback.
      if (property === 'typebox') return undefined
      if (!(property in object)) throw new Error(`Pi fixture does not inject ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  return { api, registrations, tools, handlers }
}

const fixtureFactories = {
  prime: primeHost,
  omp: ompHost,
  pi: piHost,
}

const expectedRegistrations: Record<string, Registration[]> = {
  'prime-work-browser.ts': [
    ...['terminal_read', 'browser_tabs', 'browser_navigate', 'browser_screenshot', 'browser_read_page', 'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_evaluate'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'omp-work-browser.ts': [
    ...['terminal_read', 'browser_tabs', 'browser_navigate', 'browser_screenshot', 'browser_read_page', 'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_evaluate'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'omp-work-ask-user.ts': [{ kind: 'tool', name: 'ask_user' }],
  'omp-work-collaboration.ts': [
    ...['gooeypi_session_list', 'gooeypi_session_models', 'gooeypi_session_create', 'gooeypi_session_read', 'gooeypi_session_send', 'gooeypi_session_wait'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'gooeypi-enterprise.ts': [
    { kind: 'event', name: 'before_agent_start' },
    ...['gooeypi_enterprise_team_search', 'gooeypi_enterprise_team_describe', 'gooeypi_enterprise_business_objects', 'gooeypi_enterprise_business_record_find', 'gooeypi_enterprise_business_record_read', 'gooeypi_enterprise_work_submit', 'gooeypi_enterprise_work_recover', 'gooeypi_approval_revision_submit'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'gooeypi-team-development.ts': [
    { kind: 'tool', name: 'gooeypi_team_development_list' },
    { kind: 'tool', name: 'gooeypi_team_development_open' },
    { kind: 'tool', name: 'gooeypi_team_development_propose_new' },
    { kind: 'tool', name: 'gooeypi_team_development_context' },
    { kind: 'tool', name: 'gooeypi_team_development_propose' },
  ],
  'omp-work-schedules.ts': [
    ...['scheduled_tasks_list', 'scheduled_task_create_once', 'scheduled_task_create_recurring', 'scheduled_task_update', 'scheduled_task_manage'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'pi-work-fast-mode.ts': [
    { kind: 'command', name: 'gooeypi-fast-mode' },
    { kind: 'event', name: 'before_provider_request' },
  ],
}

const brokerVariables: Partial<Record<ExtensionInjection['capability'], readonly [string, string]>> = {
  browser: ['PRIME_WORK_BROWSER_URL', 'PRIME_WORK_BROWSER_TOKEN'],
  schedule: ['PRIME_WORK_SCHEDULE_URL', 'PRIME_WORK_SCHEDULE_TOKEN'],
  collaboration: ['GOOEYPI_COLLABORATION_URL', 'GOOEYPI_COLLABORATION_TOKEN'],
  enterprise: ['GOOEYPI_ENTERPRISE_URL', 'GOOEYPI_ENTERPRISE_TOKEN'],
  teamDevelopment: ['GOOEYPI_TEAM_DEVELOPMENT_URL', 'GOOEYPI_TEAM_DEVELOPMENT_TOKEN'],
}

const LEGACY_UNPREFIXED_TOOLS = [
  'ask_user', 'terminal_read', 'browser_tabs', 'browser_navigate', 'browser_screenshot', 'browser_read_page',
  'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_evaluate',
  'scheduled_tasks_list', 'scheduled_task_create_once', 'scheduled_task_create_recurring',
  'scheduled_task_update', 'scheduled_task_manage',
]

async function loadExtension(injection: ExtensionInjection, configured: boolean) {
  vi.resetModules()
  vi.unstubAllEnvs()
  const variables = brokerVariables[injection.capability]
  if (configured && variables) {
    vi.stubEnv(variables[0], 'http://127.0.0.1:1/')
    vi.stubEnv(variables[1], 'inert-test-token')
  }
  const url = pathToFileURL(join(process.cwd(), 'assets', 'extensions', injection.filename)).href
  return (await import(url)).default as (api: object) => void | Promise<void>
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('shipped extension contracts', () => {
  it('initializes every manifest injection against its genuine host surface', async () => {
    for (const filename of SHIPPED_EXTENSION_FILENAMES) {
      expect(expectedRegistrations[filename], `Missing registration contract for ${filename}`).toBeDefined()
    }
    for (const [harness, injections] of Object.entries(EXTENSION_INJECTIONS)) {
      for (const injection of injections) {
        for (const configured of [false, true]) {
          const fixture = fixtureFactories[harness as keyof typeof fixtureFactories]()
          const factory = await loadExtension(injection, configured)
          await factory(fixture.api)
          const expected = expectedRegistrations[injection.filename]
          expect(fixture.registrations, `${harness}/${injection.filename} configured=${configured}`).toEqual(
            configured || !brokerVariables[injection.capability] ? expected : [],
          )
        }
      }
    }
  })

  it('rejects an extension that reaches for a capability its host does not inject', () => {
    const badExtension = (api: OmpExtensionApi) => {
      api.typebox!.Type.Object({})
    }
    expect(() => badExtension(ompHost().api as OmpExtensionApi)).not.toThrow()
    expect(() => badExtension(primeHost().api as OmpExtensionApi)).toThrow()
    expect(() => badExtension(piHost().api as OmpExtensionApi)).toThrow()
  })

  it('routes Pi team-development tools to the scoped desktop bridge without saving proposals', async () => {
    const requests: Array<{ url: string; options?: RequestInit; body: Record<string, unknown> }> = []
    let rejectNext = false
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>
      requests.push({ url: String(input), options, body })
      if (rejectNext) {
        rejectNext = false
        return Response.json({ ok: false, error: '团队草稿版本已变化' })
      }
      const result = body.method === 'list' ? { teams: [{ name: '反馈分类团队' }] }
        : body.method === 'propose_new_team' || body.method === 'propose' ? '提案已生成，等待开发者检查'
          : { method: body.method }
      return Response.json({ ok: true, result })
    }))
    const injection = EXTENSION_INJECTIONS.pi.find((candidate) => candidate.filename === 'gooeypi-team-development.ts')!
    const fixture = piHost()
    const factory = await loadExtension(injection, true)
    await factory(fixture.api)
    const tools = new Map((fixture.tools as Array<{ name: string; execute(id: string, params: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }> }>).map((tool) => [tool.name, tool]))

    const listed = await tools.get('gooeypi_team_development_list')!.execute('list', {})
    expect(listed.content[0]?.text).toContain('反馈分类团队')
    await tools.get('gooeypi_team_development_open')!.execute('open', { team_name: '反馈分类团队' })
    await tools.get('gooeypi_team_development_propose_new')!.execute('new', { name: '反馈团队', objective: '归类员工反馈' })
    await tools.get('gooeypi_team_development_context')!.execute('context', {})
    const proposed = await tools.get('gooeypi_team_development_propose')!.execute('propose', { operations_json: '[{"kind":"member","member":"整理员","duty":"按模块分类"}]' })
    expect(proposed.content[0]?.text).toContain('提案已生成')
    expect(requests.map(({ body }) => body.method)).toEqual(['list', 'open', 'propose_new_team', 'context', 'propose'])
    expect(requests[4]?.body.params).toEqual({ operations: [{ kind: 'member', member: '整理员', duty: '按模块分类' }] })
    for (const request of requests) expect(new Headers(request.options?.headers).get('authorization')).toBe('Bearer inert-test-token')
    await expect(tools.get('gooeypi_team_development_propose')!.execute('invalid', { operations_json: '{' })).rejects.toThrow('不是有效 JSON 数组')
    expect(requests).toHaveLength(5)
    rejectNext = true
    await expect(tools.get('gooeypi_team_development_open')!.execute('stale', { team_name: '反馈分类团队' })).rejects.toThrow('团队草稿版本已变化')
  })

  it('requires an employee turn before Pi can search authorized teams', async () => {
    const requests: Array<{ body: Record<string, unknown>; options?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>
      requests.push({ body, options })
      const result = body.method === 'activate' ? { turn_key: 'employee-turn' } : { choices: [{ name: '报价核对团队' }] }
      return Response.json({ ok: true, result })
    }))
    const injection = EXTENSION_INJECTIONS.pi.find((candidate) => candidate.filename === 'gooeypi-enterprise.ts')!
    const fixture = piHost()
    const factory = await loadExtension(injection, true)
    await factory(fixture.api)
    const tools = new Map((fixture.tools as Array<{ name: string; execute(id: string, params: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }> }>).map((tool) => [tool.name, tool]))
    const search = tools.get('gooeypi_enterprise_team_search')!

    await expect(search.execute('before-turn', { work_summary: '核对报价明细' })).rejects.toThrow('当前没有已绑定的员工轮次')
    await fixture.handlers?.get('before_agent_start')?.({ prompt: '请帮我核对这份报价。' })
    const result = await search.execute('search', { work_summary: '核对报价明细' })
    expect(result.content[0]?.text).toContain('报价核对团队')
    expect(requests.map(({ body }) => body.method)).toEqual(['activate', 'search'])
    expect(requests[1]?.body.params).toEqual({ work_summary: '核对报价明细', turn_key: 'employee-turn' })
    expect(new Headers(requests[0]?.options?.headers).get('authorization')).toBe('Bearer inert-test-token')
  })

  it('keeps tool registrations namespaced', () => {
    // The allow-list only shrinks as legacy tools are renamed. See #192.
    for (const registrations of Object.values(expectedRegistrations)) {
      for (const registration of registrations) {
        if (registration.kind !== 'tool') continue
        expect(registration.name.startsWith('gooeypi_') || LEGACY_UNPREFIXED_TOOLS.includes(registration.name)).toBe(true)
      }
    }
  })

  it('rejects properties outside each host fixture from the proxy trap', () => {
    for (const [harness, factory] of Object.entries(fixtureFactories)) {
      const fixture = factory()
      expect(() => Reflect.get(fixture.api, 'unsupportedCapability'), harness).toThrow(`${harness === 'prime' ? 'Prime' : harness === 'omp' ? 'OMP' : 'Pi'} fixture does not inject unsupportedCapability`)
    }
  })

  it('derives the shipped inventory from the actual extension directory', () => {
    const actual = readdirSync(join(process.cwd(), 'assets', 'extensions'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => entry.name)
      .sort()
    expect(SHIPPED_EXTENSION_FILENAMES).toEqual(actual)
  })
})
