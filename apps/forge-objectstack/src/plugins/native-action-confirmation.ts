import { registerActionTools } from '@objectstack/mcp';

type ToolDeclaration = { inputSchema?: unknown };
type SchemaMember = { safeParse(value: unknown): { success: boolean } };
type Registrar = typeof registerActionTools;

/** Read the public MCP registration contract without opening a transport or invoking a tool. */
export function nativeActionConfirmationSupported(register: Registrar = registerActionTools): boolean {
  let inputSchema: unknown;
  const server = {
    registerTool(name: string, declaration: ToolDeclaration): void {
      if (name === 'run_action') inputSchema = declaration.inputSchema;
    },
  } as unknown as Parameters<Registrar>[0];
  register(server, { listActions: async () => [], runAction: async () => undefined });
  if (!inputSchema || typeof inputSchema !== 'object') return false;
  const shape = 'shape' in inputSchema && inputSchema.shape && typeof inputSchema.shape === 'object'
    ? inputSchema.shape : inputSchema;
  const member = (shape as Record<string, SchemaMember | undefined>).confirm;
  return typeof member?.safeParse === 'function'
    && member.safeParse(true).success && member.safeParse(false).success
    && !member.safeParse('true').success && !member.safeParse(null).success;
}

/** This is declaration metadata, never a client or model-provided confirmation value. */
export function nativeActionRequiresConfirmation(definition: Record<string, unknown>): boolean {
  const ai = definition.ai;
  if (ai == null) return false;
  if (typeof ai !== 'object' || Array.isArray(ai)) throw new Error('原生动作确认声明无效');
  const required = (ai as Record<string, unknown>).requiresConfirmation;
  if (required !== undefined && typeof required !== 'boolean') throw new Error('原生动作确认声明无效');
  return required === true;
}
