/** Pi tools for the developer's currently open team draft. Draft saves, isolated trials, and publish are separately scoped. */
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

const operationGuidance = [
  '新增成员完整操作为 {kind:"member_add",ref:"new_worker",name:"材料协调员",duty:"整理本次材料并保留原文依据"}；ref、name、duty 均必填。ref 只供同一组后续操作引用。新增成员默认是 worker、使用 loom，模型沿用当前草稿首个 worker 的模型；业务动作和技能默认空，不自动复制其他成员的授权。',
  '修改已有步骤执行者使用 {kind:"step",flow:"流程准确名称",step:"步骤准确名称",member:"成员准确名称或本组新增ref"}；可附 requirement 更新工作要求。选择负责人会变为 lead，选择执行成员会变为 worker；节点 id、edges、inputs 和声明输出保持原值。无需删除重建步骤。',
  '操作接口以本工具说明和 gooeypi_team_development_context 返回内容为准；不要扫描环境、历史会话或本机源码猜参数。缺少引用先读取上下文，不编造操作名或字段。',
]

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
    description: '根据开发者明确说出的团队名称或刚查到的准确名称打开可开发草稿；随后读取上下文再修改或提出建议。',
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
    description: '向 Pi 主会话右侧的团队开发面板提交结构化修改提案。传入 JSON 数组字符串；此操作只生成待预览候选，不应用、不保存、不发布。支持团队、成员、技能、业务动作、流程步骤、步骤输入、交付来源、结果分类和汇合条件的受控修改。',
    promptGuidelines: [
      ...operationGuidance,
      '仅在开发者只要求查看方案或先预览改动时使用。若开发者明确要求实际修改团队草稿，使用“修改并保存团队草稿”。以准确名称打开团队后再提出最小修改。不要编辑本地文件、调用员工交接能力或编造业务动作。',
      'member/flow/step/capability 引用使用草稿和动作目录返回的准确名称；新成员先用 member_add 的 ref 创建，后续操作可用该 ref。同名对象需要开发者先在侧栏区分。',
      '配置业务动作的材料来源时，使用 parameterSources 按接口参数逐项映射；只使用当前目录返回的准确参数名。原生单值 file 参数默认由 Pi 从本轮可用材料中选择；如开发者明确绑定唯一文件，只有本轮恰有一件材料时才映射 materials.single.id，不映射文件名称或摘要。原生 multiple file 参数必须映射到 materials.ids，例如 {"kind":"capability","member":"材料提交员","capability":"提交材料包","selected":true,"parameterSources":[{"name":"primary_file_id","source":"materials.single.id"},{"name":"material_file_ids","source":"materials.ids"}]}。materials.ids 表示本次提交的全部文件；不得把 file/multiple 参数当作成员自由填写，也不得根据参数名猜测材料来源。materials.manifest_json 只用于文本参数。',
      '新增串行步骤可由负责人或执行成员负责；新增并行分支只能选择执行成员。并行分支必须由单个成员直接进入汇合，不能在分支内部再插串行步骤。要在并行检查后增加后续工作，把 after 指向“并行分工”步骤，平台会将新步骤放到汇合之后。使用 {kind:"step_add",flow:"合同复核流程",after:"并行分工",member:"合同协调员",name:"汇总检查结果",requirement:"汇总分支结论和原文依据",placement:"serial"}。不要猜测步骤或成员名称。',
      '修改已有步骤的处理指令或交付要求，使用 {kind:"step",flow:"合同复核流程",step:"理解任务",requirement:"保留原文后的完整新指令"}。必须提供 step 和 requirement；没有 instruction、target 或 step_ref 字段。负责人步骤的 requirement 写入处理指令，成员步骤写入交付要求。',
      '控制每步可见内容用 step_input，source 只能是 run_input 或 node_output；后一种必须提供 from 前序步骤名称，selected 表示添加或移除。技能正文用 skill 操作。删除成员或步骤先处理流程引用。',
      '结果分类使用 {kind:"result_protocol",flow:"合同复核流程",enabled:true} 启用，enabled:false 恢复普通结果；可选 from 指向当前流程中的负责人或成员步骤。仅负责人/成员步骤可生成“完成/需要补充”的固定结构。若当前交付来源是并行汇合等不支持类型，先在汇合后添加负责汇总的成员步骤，并调整交付来源。不要改写成员已有的业务指令来塞入格式要求。',
      '提案成功后说明具体修改并等待开发者在主会话右侧的团队开发面板检查；不要声称已经保存或生效。',
    ],
    parameters: Type.Object({ operations_json: Type.String({ minLength: 2, maxLength: 100_000, description: '结构化团队修改 JSON 数组' }) }),
    async execute(_id, params) {
      let operations: unknown
      try { operations = JSON.parse(params.operations_json) } catch { throw new Error('修改内容不是有效 JSON 数组') }
      return result(await call('propose', { operations }))
    },
  })
  pi.registerTool<{ operations_json: string }>({
    name: 'gooeypi_team_development_save', label: '修改并保存团队草稿',
    description: '按受控修改操作直接更新当前已打开团队的未发布草稿。只在开发者明确要求修改时使用；如果只要建议，使用“提出团队修改”。保存草稿不会更新当前生效团队。',
    promptGuidelines: [
      ...operationGuidance,
      '先用团队列表和准确名称打开目标，再读取当前上下文。用户明确要求修改时，可以直接提交最小 operations JSON 数组并保存，无须先走待审提案。',
      '只引用上下文中的团队成员、流程、步骤和业务动作；不得填内部 ID、绕过受控 operation 或自行编造动作。添加后续操作时使用本轮返回的准确业务名称。',
      '修改已有负责人步骤的处理指令：{kind:"step",flow:"合同复核流程",step:"理解任务",requirement:"保留原文后的完整新指令"}。执行成员步骤也用 requirement 更新工作要求；不要使用 instruction、target 或 step_ref。',
      '保存成功只表示未发布草稿已保存。用户要求调试时再调用隔离试跑；只有用户明确说“更新团队”或“发布”后才可调用更新团队。',
      '如果上次保存结果不确定，原样重试同一组操作；不要换一组操作覆盖未确认的修改。',
    ],
    parameters: Type.Object({ operations_json: Type.String({ minLength: 2, maxLength: 100_000, description: '结构化团队修改 JSON 数组' }) }),
    async execute(_id, params) {
      let operations: unknown
      try { operations = JSON.parse(params.operations_json) } catch { throw new Error('修改内容不是有效 JSON 数组') }
      return result(await call('save', { operations }))
    },
  })
  pi.registerTool<{ workflow_name: string; input: string }>({
    name: 'gooeypi_team_development_trial', label: '隔离试跑团队流程',
    description: '在当前团队已保存草稿上隔离模拟一条流程。此试跑会记录业务动作模拟调用，不携带凭据，也不访问或写入 Forge。相同会话、团队、流程、修订和输入会复用同一次试跑。',
    promptGuidelines: [
      '调试前读取团队上下文并确保修改已保存。流程名必须与当前草稿完全一致，测试输入只使用开发者提供或明确授权的材料。',
      '相同会话、团队、流程、修订和测试输入重试时，系统会复用同一次试跑。不要为同一输入重复启动；需要新的试跑时，先取得开发者明确提供的新测试输入。',
      '试跑后调用试跑状态读取固定输入和逐步活动。Weave 的步骤 inputs 是输入摘要，不能冒充完整原文；工具 input/output 是实际记录。活动完整性未达到 complete 时要明确说明缺失，不能仅凭最终结果声称试跑通过。',
    ],
    parameters: Type.Object({
      workflow_name: Type.String({ minLength: 1, maxLength: 128 }),
      input: Type.String({ minLength: 1, maxLength: 650_000 }),
    }),
    async execute(_id, params) { return result(await call('trial', params)) },
  })
  pi.registerTool({
    name: 'gooeypi_team_development_trial_status', label: '读取试跑步骤与结果',
    description: '读取当前 Pi 会话最近一次隔离试跑，包含固定输入全文、逐步输入摘要与实际步骤输出、工具输入输出、最终结果和轨迹完整性。不会返回内部运行标识。',
    promptGuidelines: ['试跑开始或重试后读取本工具。逐步 inputs 是摘要，outputs 是 Weave 实际保存的步骤结果；输出标为 truncated 或活动完整性为 partial/unavailable 时，明确说明相应内容不完整，不能只凭最终结果声称全程通过。'],
    parameters: Type.Object({}),
    async execute() { return result(await call('trial_status')) },
  })
  pi.registerTool({
    name: 'gooeypi_team_development_update_team', label: '更新团队',
    description: '发布当前已保存且完成所需试跑的团队草稿。只在开发者明确要求“更新团队”或“发布”时调用；更新后新工作使用此版本。',
    promptGuidelines: ['只有开发者在当前对话明确要求更新团队或发布时才调用。调用前说明已保存修改和试跑结果；不要把建议、保存或试跑等同于更新团队。'],
    parameters: Type.Object({}),
    async execute() { return result(await call('update_team')) },
  })
}
