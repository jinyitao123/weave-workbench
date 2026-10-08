import { readEmployeeBusinessWork } from './employee-business-work.js';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import { EmployeeBusinessService } from './employee-business-service.js';
import { service, TaskConnectionFailure } from './native-task-auth.js';
import { LEAD_CREATE_TARGET, CONTRACT_DRAFT_TERMS_TARGET, createEmployeeLead, updateContractDraftPaymentTerm } from './employee-business-creation.js';

async function error(response: IHttpResponse, value: unknown): Promise<void> {
  const known = value instanceof TaskConnectionFailure;
  await response.status(known ? value.status : 503).json({ error: {
    code: known ? value.code : 'EMPLOYEE_ACTION_UNAVAILABLE',
    message: known ? value.message : '本人业务办理暂不可用，请保留原请求后核对',
  } });
}

/** Version/intent/receipt connection only. Every business mutation still uses
 * the standard employee identity, native MCP dispatcher and declared Action. */
export class EmployeeBusinessActionPlugin implements Plugin {
  name = 'com.inocube.forge.employee-business-action';
  version = '1.0.0';
  type = 'standard' as const;
  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server'), actions = new EmployeeBusinessService(context);
      actions.engine.registerAction('forge_sales_lead', LEAD_CREATE_TARGET, action => createEmployeeLead(actions.engine, action), this.name);
      actions.engine.registerAction('forge_sales_contract', CONTRACT_DRAFT_TERMS_TARGET, action => updateContractDraftPaymentTerm(actions.engine, action), this.name);
      for (const [path, handler] of [
        ['/api/v1/workbench/business-work', (request: import('@objectstack/spec/contracts').IHttpRequest) => readEmployeeBusinessWork(context, request)],
        ['/api/v1/workbench/business-actions/catalog', actions.catalog.bind(actions)],
        ['/api/v1/workbench/business-actions/context', actions.readContext.bind(actions)],
        ['/api/v1/workbench/business-actions/operations/:id', actions.readOperation.bind(actions)],
      ] as const) server.get(path, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try { await response.status(200).json(await handler(request)); } catch (value) { await error(response, value); }
      });
      server.post('/api/v1/workbench/business-actions/execute', async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try { await response.status(200).json(await actions.execute(request)); } catch (value) { await error(response, value); }
      });
    });
  }
}
