/** Pi tools for the developer's currently open team draft. No remote writes. */
interface Typebox {
  Object(properties: Record<string, unknown>): unknown
  String(options?: Record<string, unknown>): unknown
}
interface ExtensionApi {
  typebox?: { Type: Typebox }
  registerTool<T>(tool: { name: string; label: string; description: string; promptGuidelines?: string[]; parameters: unknown; execute(id: string, params: T): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> }): void
}

const url = process.env.GOOEYPI_TEAM_DEVELOPMENT_URL
const token = process.env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN

async function call(method: string, params: Record<string, unknown> = {}) {
  if (!url || !token) throw new Error('当前 Pi 会话没有团队开发上下文')
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
  const body = await response.json() as { ok: boolean; result?: unknown; error?: string }
  if (!body.ok) throw new Error(body.error ?? '团队开发请求失败')
  return body.result
}

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], details: {} } }

export default async function (pi: ExtensionApi): Promise<void> {
  if (!url || !token) return
  const Type = pi.typebox?.Type ?? ((await import('typebox')) as { Type: Typebox }).Type
  if (!Type) throw new Error('当前 Pi 运行时不支持团队开发工具参数')
  pi.registerTool({
    name: 'gooeypi_team_development_list', label: '查找可开发团队',
    description: '仅在开发者明确要求创建或修改智能体团队时，列出当前账号有权开发的团队。员工业务交接请使用员工团队工具。',
    parameters: Type.Object({}),
    async execute() { return result(await call('list')) },
  })
  pi.registerTool<{ team_name: string }>({
    name: 'gooeypi_team_development_open', label: '打开团队开发草稿',
    description: '根据开发者明确说出的团队名称或刚查到的准确名称打开可开发草稿；随后读取上下文再提案。',
    parameters: Type.Object({ team_name: Type.String({ minLength: 1, maxLength: 128 }) }),
    async execute(_id, params) { return result(await call('open', params)) },
  })
  pi.registerTool<{ name: string; objective: string }>({
    name: 'gooeypi_team_development_propose_new', label: '提出新团队',
    description: '开发者明确要求新建智能体团队时，提交团队名称和承接目标。右侧开发面板显示提案；只有开发者点击创建才写入 Weave。',
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), objective: Type.String({ minLength: 1, maxLength: 2000 }) }),
    async execute(_id, params) { return result(await call('propose_new_team', params)) },
  })
  pi.registerTool({
    name: 'gooeypi_team_development_context', label: '查看团队开发草稿',
    description: '读取已打开的团队草稿、成员、流程及可绑定的 Forge 业务动作目录。修改必须基于这里返回的成员、流程和步骤引用。',
    parameters: Type.Object({}),
    async execute() { return result(await call('context')) },
  })
  pi.registerTool<{ operations_json: string }>({
    name: 'gooeypi_team_development_propose', label: '提出团队修改',
    description: '向 Pi 主会话右侧的团队开发面板提交结构化修改提案。传入 JSON 数组字符串；此操作只生成待预览候选，不应用、不保存、不发布。支持团队、成员、技能、业务动作、流程步骤、步骤输入、交付来源和汇合条件的受控修改。',
    promptGuidelines: [
      '只有开发者明确要求修改团队时才使用。以准确名称打开团队；名称不明确时先查找。随后读取草稿并提出最小修改。不要编辑本地文件、调用员工交接能力或编造业务动作。',
      'member/flow/step/capability 引用使用草稿和动作目录返回的准确名称；新成员先用 member_add 的 ref 创建，后续操作可用该 ref。同名对象需要开发者先在侧栏区分。',
      '示例：[{"kind":"member","member":"合同条款检查员","duty":"新职责"},{"kind":"capability","member":"合同提交员","capability":"提交指定合同版本","selected":true,"fileSource":"single"}]。fileSource 仅在动作声明单文件标识、名称、摘要三项时用 single，否则选 member。',
      '新增串行步骤可由负责人或执行成员负责；新增并行分支只能选择执行成员。并行分支必须由单个成员直接进入汇合，不能在分支内部再插串行步骤。要在并行检查后增加后续工作，把 after 指向“并行分工”步骤，平台会将新步骤放到汇合之后。使用 {kind:"step_add",flow:"合同复核流程",after:"并行分工",member:"合同协调员",name:"汇总检查结果",requirement:"汇总分支结论和原文依据",placement:"serial"}。不要猜测步骤或成员名称。',
      '控制每步可见内容用 step_input，source 只能是 run_input 或 node_output；后一种必须提供 from 前序步骤名称，selected 表示添加或移除。技能正文用 skill 操作。删除成员或步骤先处理流程引用。',
      '提案成功后说明具体修改并等待开发者在主会话右侧的团队开发面板检查、应用和保存；不要声称已经生效。',
    ],
    parameters: Type.Object({ operations_json: Type.String({ minLength: 2, maxLength: 100_000, description: '结构化团队修改 JSON 数组' }) }),
    async execute(_id, params) {
      let operations: unknown
      try { operations = JSON.parse(params.operations_json) } catch { throw new Error('修改内容不是有效 JSON 数组') }
      return result(await call('propose', { operations }))
    },
  })
}
