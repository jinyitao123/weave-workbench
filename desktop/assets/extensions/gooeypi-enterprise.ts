/** Enterprise team handoff tools shared by Prime Agent, OMP, and Pi. */

interface SchemaOptions { description?: string; minLength?: number; maxLength?: number }
interface HostTypebox {
  Object(properties: Record<string, unknown>, options?: SchemaOptions): unknown
  String(options?: SchemaOptions): unknown
  Array(items: unknown, options?: SchemaOptions): unknown
}
interface ToolResult { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }
interface ExtensionApi {
  on(event: 'before_agent_start', handler: (event: { prompt: string }) => Promise<void>): void
  typebox?: { Type: HostTypebox }
  registerTool<Params>(tool: {
    name: string
    label: string
    description: string
    promptGuidelines?: string[]
    parameters: unknown
    execute(id: string, params: Params): Promise<ToolResult>
  }): void
}

async function importHostModule(specifier: string): Promise<Record<string, unknown> | undefined> {
  try { return (await import(specifier)) as Record<string, unknown> } catch { return undefined }
}

async function resolveHostTypebox(): Promise<HostTypebox> {
  const Type = (await importHostModule('typebox'))?.Type as HostTypebox | undefined
  if (Type) return Type
  return {
    Object: (properties, options) => ({ type: 'object', properties, required: Object.keys(properties), ...(options ?? {}) }),
    String: (options) => ({ type: 'string', ...(options ?? {}) }),
    Array: (items, options) => ({ type: 'array', items, ...(options ?? {}) }),
  }
}

interface BridgeResult { ok: boolean; result?: unknown; error?: string }
const BRIDGE_URL = process.env.GOOEYPI_ENTERPRISE_URL
const BRIDGE_TOKEN = process.env.GOOEYPI_ENTERPRISE_TOKEN

async function call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!BRIDGE_URL || !BRIDGE_TOKEN) throw new Error('当前桌面会话没有可用的企业团队能力')
  let response: Response
  try {
    response = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${BRIDGE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
  } catch (error) {
    throw new Error(`无法连接桌面企业团队能力：${String(error)}`)
  }
  const body = (await response.json()) as BridgeResult
  if (!body.ok) throw new Error(body.error || `企业团队请求失败（${response.status}）`)
  return body.result
}

function result(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], details: {} }
}

export default function (pi: ExtensionApi): void | Promise<void> {
  if (!BRIDGE_URL || !BRIDGE_TOKEN) return
  const Type = pi.typebox?.Type
  if (Type) { registerTools(pi, Type); return }
  return resolveHostTypebox().then((resolved) => { registerTools(pi, resolved) })
}

function registerTools(pi: ExtensionApi, Type: HostTypebox): void {
  let turnKey: string | undefined
  pi.on('before_agent_start', async (event) => {
    turnKey = undefined
    try {
      const active = await call('activate', { prompt: event.prompt.trim() }) as { turn_key: string }
      turnKey = active.turn_key
    } catch { /* Ordinary local work does not require enterprise sign-in. */ }
  })
  const turnCall = (method: string, params: Record<string, unknown>) => {
    if (!turnKey) throw new Error('当前没有已绑定的员工轮次，请等待员工输入后继续')
    return call(method, { ...params, turn_key: turnKey })
  }
  pi.registerTool({
    name: 'gooeypi_enterprise_team_search',
    label: '查找企业团队',
    description: '按当前工作摘要筛选员工有权使用的企业团队名称和目标，供你继续判断。只返回团队名称和目标，不展开成员、流程或内部配置。',
    promptGuidelines: [
      '结合完整对话判断当前工作是否需要企业团队继续处理；不要按最后一句中的关键词触发。',
      '用业务语言概括当前工作后再查找，不要把团队、成员、流程版本等技术选择交给员工。',
      '没有候选或多个候选都同样适合时，在原会话只询问缺失的业务信息，不要求员工选择团队、成员或流程版本。',
    ],
    parameters: Type.Object({
      work_summary: Type.String({ minLength: 1, maxLength: 4_000, description: '根据完整对话概括的当前工作与期望结果' }),
    }),
    async execute(_id, params) { return result(await turnCall('search', params as Record<string, unknown>)) },
  })

  pi.registerTool<{ team_key: string }>({
    name: 'gooeypi_enterprise_team_describe',
    label: '查看团队承接能力',
    description: '展开一个候选团队当前已发布的承接能力和接单要求。只有需要判断该团队是否适合时才调用。',
    promptGuidelines: [
      'team_key 只能来自本会话最近一次团队查找；不要编造或跨会话沿用。',
      '只查看最可能适合的候选；信息不足时先向员工询问业务事实，不要依次展开所有团队。',
      '接什么、需要什么、交付什么以团队目标和流程说明为准；缺少关键业务信息时询问员工，不要求填写结构化配置。',
    ],
    parameters: Type.Object({
      team_key: Type.String({ minLength: 1, maxLength: 128, description: '团队查找返回的候选键' }),
    }),
    async execute(_id, params) { return result(await turnCall('describe', params)) },
  })

  pi.registerTool<{ handoff_key: string; goal: string; materials: Array<{ path: string; sha256: string }> }>({
    name: 'gooeypi_enterprise_work_submit',
    label: '提交给企业团队',
    description: '把当前会话中的工作交给刚刚查看过的团队承接能力。桌面核验本次员工轮次、账号和指定材料版本，冻结全文并取得接单回执。',
    promptGuidelines: [
      '根据完整对话判断员工是否同意把当前工作交给企业团队；语义不清楚时在原会话自然确认。',
      'handoff_key 必须来自本会话最近一次团队承接能力查看；不得编造或沿用其他会话的结果。',
      'goal 要概括需要团队继续完成的工作和预期结果，不要加入员工没有表达的业务事实。',
      'materials 必须列出员工指定版本的实际工作文件及读取时核对的 SHA-256；当前支持工作目录内 UTF-8 文本或 Markdown。没有实际材料时先补齐，不得只提交目标或哈希。',
      '员工说先等等或改变要求后停止旧交接；失败时重试相同参数，不重新生成版本或目标。接单回执仅代表服务接受，不能声称团队已经处理完成。收到接单回执后结束本轮，不轮询团队结果；结果和退回事项会进入员工的“我的工作”。向员工用“已接单”“结果待核对”等中文报告，不展示 accepted 等状态编码、内部标识或哈希。',
      '本工具只交给 Weave 团队，不代表 Forge 业务状态已经提交或审批通过。',
    ],
    parameters: Type.Object({
      handoff_key: Type.String({ minLength: 1, maxLength: 128, description: '团队承接能力查看返回的交接键' }),
      goal: Type.String({ minLength: 1, maxLength: 20_000, description: '交给团队的工作目标和预期结果' }),
      materials: Type.Array(Type.Object({
        path: Type.String({ minLength: 1, description: '当前工作目录中的材料文件路径' }),
        sha256: Type.String({ minLength: 64, maxLength: 64, description: '读取员工指定版本时核对的文件 SHA-256' }),
      })),
    }),
    async execute(_id, params) { return result(await turnCall('submit', params)) },
  })
  pi.registerTool<{ recovery_key: string }>({
    name: 'gooeypi_enterprise_work_recover',
    label: '核对原交接',
    description: '按原交接凭据核对或重试已经冻结的同一份工作；仅用于网络失败、结果未知或桌面重开后的恢复。不会读取新文件或创建新的请求编号，也不能用于等待团队完成。',
    promptGuidelines: [
      'recovery_key 必须来自原会话的提交结果。只有当前员工仍要求交接该版本时才调用；先别发或修改材料时不能继续旧交接。',
      'unknown 表示接单结果待核对；accepted 才表示已接单。恢复失败不能改用提交工具创建另一份工作。团队已经接单后不要调用本工具轮询处理结果。',
    ],
    parameters: Type.Object({ recovery_key: Type.String({ minLength: 64, maxLength: 64, description: '原提交结果中的恢复凭据' }) }),
    async execute(_id, params) { return result(await turnCall('recover', params)) },
  })
}

export type EnterpriseExtensionApi = ExtensionApi
