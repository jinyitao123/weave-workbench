import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import {
  SalesPerformanceRebookExportCreate,
  SalesPerformanceWorkspaceQuery,
} from '../actions/sales-performance.action.js';
import {
  formatOrganizationBusinessDate,
  organizationBusinessContext,
} from './project-business-date.plugin.js';

export const SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY = '__forge_business_dates';

const PACKAGE = 'com.inoforge.forge.sales-performance-calendar';
const SALES_PERFORMANCE_ACTIONS = [
  SalesPerformanceWorkspaceQuery,
  SalesPerformanceRebookExportCreate,
] as const;

const PROJECTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  forge_sales_performance_entry: ['confirmed_at', 'submitted_at', 'created_at'],
  forge_sales_performance_confirmation: ['approved_at', 'submitted_at', 'created_at'],
  forge_sales_performance_rebook: ['approved_at', 'submitted_at', 'created_at'],
  forge_sales_order: ['completed_at'],
};

type Row = Record<string, unknown>;
type ActionLike = {
  name: string;
  object?: string;
  objectName?: string;
  type?: string;
  body?: unknown;
  timeoutMs?: number;
};
type ActionContextLike = {
  user?: { id?: string; organizationId?: string };
  session?: { userId?: string; organizationId?: string };
  api?: { object?: (objectName: string) => unknown };
  [key: string]: unknown;
};
export type SalesPerformanceCalendarActionHandler = ((actionContext: ActionContextLike) => Promise<unknown>) & {
  dispose(): Promise<void>;
};
export type SalesPerformanceCalendarHandlerOptions = {
  appId?: string;
  logger?: unknown;
  actionTimeoutMs?: number;
};

const isRecord = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

function currentIdentity(actionContext: ActionContextLike) {
  const sessionUser = String(actionContext.session?.userId || '').trim();
  const userUser = String(actionContext.user?.id || '').trim();
  if (sessionUser && userUser && sessionUser !== userUser) {
    throw new Error('当前操作人和组织上下文不一致');
  }
  const userId = sessionUser || userUser;
  const sessionOrganization = String(actionContext.session?.organizationId || '').trim();
  const userOrganization = String(actionContext.user?.organizationId || '').trim();
  if (sessionOrganization && userOrganization && sessionOrganization !== userOrganization) {
    throw new Error('当前操作人和组织上下文不一致');
  }
  const organizationId = sessionOrganization || userOrganization;
  if (!userId || !organizationId) throw new Error('无法确认当前操作人和组织日期上下文');
  return { userId, organizationId };
}

function organizationIdOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!isRecord(value)) return '';
  const id = String(value.id ?? '').trim();
  const labelValue = String(value.value ?? '').trim();
  if (id && labelValue && id !== labelValue) return '';
  return id || labelValue;
}

function timestampBusinessDate(value: unknown, timezone: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return formatOrganizationBusinessDate(value, timezone);
  }
  const raw = String(value).trim();
  // These projections are only for declared datetime fields. A date-only
  // string is not an instant and must not be shifted through a timezone.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))$/i.exec(raw);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = match[6] === undefined ? 0 : Number(match[6]);
  const daysInMonth = month === 2
    ? ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59) return null;
  if (match[9] !== undefined && (Number(match[9]) > 23 || Number(match[10]) > 59)) return null;
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) return null;
  return formatOrganizationBusinessDate(instant, timezone);
}

function projectRow(objectName: string, source: unknown, organizationId: string, timezone: string): unknown {
  if (!isRecord(source)) return source;
  const clone = { ...source };
  // Never let a stored or caller-shaped property impersonate this host projection.
  delete clone[SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY];
  if (organizationIdOf(source.organization_id) !== organizationId) return clone;
  const fields = PROJECTION_FIELDS[objectName];
  if (!fields) return clone;
  const dates: Record<string, string | null> = {};
  for (const field of fields) dates[field] = timestampBusinessDate(source[field], timezone);
  clone[SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY] = dates;
  return clone;
}

function projectReadResult(objectName: string, result: unknown, organizationId: string, timezone: string): unknown {
  if (Array.isArray(result)) return result.map(row => projectRow(objectName, row, organizationId, timezone));
  return projectRow(objectName, result, organizationId, timezone);
}

function withBusinessDateReadProjection(
  api: NonNullable<ActionContextLike['api']>,
  organizationId: string,
  timezone: string,
) {
  if (typeof api.object !== 'function') throw new Error('组织日期适配缺少ObjectQL对象读取接口');
  return new Proxy(api, {
    get(target, property) {
      if (property !== 'object') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (objectName: string) => {
        const repository = target.object!.call(target, objectName) as Record<PropertyKey, unknown> | null | undefined;
        if (!repository || !['find', 'findOne'].some(method => typeof repository[method] === 'function')) {
          return repository;
        }
        return new Proxy(repository, {
          get(rowTarget, rowProperty) {
            const value = Reflect.get(rowTarget, rowProperty, rowTarget);
            if ((rowProperty === 'find' || rowProperty === 'findOne') && typeof value === 'function') {
              return async (...args: unknown[]) => projectReadResult(
                objectName,
                await Reflect.apply(value, rowTarget, args),
                organizationId,
                timezone,
              );
            }
            return typeof value === 'function' ? value.bind(rowTarget) : value;
          },
        });
      };
    },
  });
}

function stripBusinessDateProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBusinessDateProjection);
  if (!isRecord(value) || value instanceof Date) return value;
  const clean: Row = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY) continue;
    clean[key] = stripBusinessDateProjection(item);
  }
  return clean;
}

function runnerAction(action: ActionLike) {
  const object = String(action.object || action.objectName || '').trim();
  return { ...action, object };
}

/**
 * Build the sole registered handler while continuing to run the action's
 * declared QuickJS body. The read adapter decorates only rows returned during
 * this action invocation and never persists or rewrites source timestamps.
 */
export function createSalesPerformanceCalendarActionHandler(
  engine: IObjectQLEngine,
  action: ActionLike,
  options: SalesPerformanceCalendarHandlerOptions = {},
): SalesPerformanceCalendarActionHandler {
  const runner = new QuickJSScriptRunner(options.actionTimeoutMs === undefined
    ? undefined
    : { actionTimeoutMs: options.actionTimeoutMs });
  const bodyFactory = actionBodyRunnerFactory(runner, {
    ql: engine,
    appId: options.appId || 'com.inoforge.forge.sales',
    logger: options.logger,
  });
  const scriptHandler = bodyFactory(runnerAction(action));
  if (!scriptHandler) {
    void runner.dispose();
    throw new Error(`销售业绩Action '${action.name}'没有可运行的声明式script body`);
  }

  let disposed = false;
  const handler = (async (rawActionContext: ActionContextLike) => {
    if (disposed) throw new Error('销售业绩日期适配器已停止');
    const actionContext = rawActionContext && typeof rawActionContext === 'object' ? rawActionContext : {};
    const api = actionContext.api;
    if (!api || typeof api.object !== 'function') throw new Error('销售业绩日期适配缺少认证ObjectQL API');
    const { userId, organizationId } = currentIdentity(actionContext);
    const calendar = await organizationBusinessContext(engine, {
      isSystem: true,
      userId,
      tenantId: organizationId,
    } as ExecutionContext);
    const adaptedContext = {
      ...actionContext,
      api: withBusinessDateReadProjection(api, organizationId, calendar.timezone),
    };
    const result = await scriptHandler(adaptedContext);
    return stripBusinessDateProjection(result);
  }) as SalesPerformanceCalendarActionHandler;

  handler.dispose = async () => {
    if (disposed) return;
    disposed = true;
    await runner.dispose();
  };
  return handler;
}

/**
 * Package adapter registration. `kernel:ready` runs after every plugin's
 * `start()`, including AppPlugin's bundle action registration; this last-write
 * registration is required because ObjectQL has one handler slot per key.
 */
export class SalesPerformanceCalendarPlugin implements Plugin {
  name = PACKAGE;
  version = '1.0.0';
  type = 'standard' as const;
  requiresServices = ['objectql'];
  private engine?: IObjectQLEngine;
  private handlers: SalesPerformanceCalendarActionHandler[] = [];

  init(): void {}

  start(context: PluginContext): void {
    const engine = context.getService<IObjectQLEngine>('objectql');
    this.engine = engine;
    context.hook('kernel:ready', async () => {
      if (this.handlers.length) return;
      const handlers = SALES_PERFORMANCE_ACTIONS.map(action => createSalesPerformanceCalendarActionHandler(engine, action, {
        appId: 'com.inoforge.forge.sales',
        logger: context.logger,
      }));
      try {
        for (let index = 0; index < SALES_PERFORMANCE_ACTIONS.length; index++) {
          const action = SALES_PERFORMANCE_ACTIONS[index];
          const objectName = String(action.objectName || '').trim();
          if (!objectName) throw new Error(`销售业绩Action '${action.name}'缺少目标对象`);
          engine.registerAction(objectName, action.name, handlers[index], PACKAGE);
        }
        this.handlers.push(...handlers);
      } catch (error) {
        engine.removeActionsByPackage(PACKAGE);
        await Promise.all(handlers.map(handler => handler.dispose()));
        throw error;
      }
    });
  }

  async destroy(): Promise<void> {
    this.engine?.removeActionsByPackage(PACKAGE);
    const handlers = this.handlers.splice(0);
    await Promise.all(handlers.map(handler => handler.dispose()));
    this.engine = undefined;
  }
}
