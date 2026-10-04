import { AsyncLocalStorage } from 'node:async_hooks';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

type Row = Record<string, unknown>;
type UpdateOptions = { context?: Record<string, unknown>; [key: string]: unknown };
type MutableEngine = {
  insert(...args: unknown[]): Promise<unknown>;
  update(...args: unknown[]): Promise<unknown>;
  find(...args: unknown[]): Promise<unknown>;
  findOne(...args: unknown[]): Promise<unknown>;
};

const PACKAGE_ID = 'com.inoforge.forge.service-file-reference-transaction-bridge';
const FILE_REFERENCE_FIELDS = new Set([
  'forge_quotation\u0000sent_evidence_attachment',
  'forge_quotation\u0000customer_acceptance_evidence_attachment',
]);
const activeFileWrite = new AsyncLocalStorage<unknown>();
const installedEngines = new WeakSet<object>();

/**
 * ObjectStack 17.3/17.5's storage file-reference hooks write sys_file with a system
 * context that omits the enclosing SQL transaction. Carry the caller's
 * transaction to that narrow nested sys_file write only while an explicitly
 * listed file field is being inserted or updated.
 */
export function installServiceFileReferenceTransactionBridge(engine: IObjectQLEngine): void {
  if (installedEngines.has(engine as object)) return;
  installedEngines.add(engine as object);
  const mutable = engine as MutableEngine;
  const insert = mutable.insert.bind(engine);
  const update = mutable.update.bind(engine);
  const find = mutable.find.bind(engine);
  const findOne = mutable.findOne.bind(engine);
  mutable.insert = async (objectValue, dataValue, optionsValue = {}) => {
    const object = String(objectValue || '');
    const data = (dataValue && typeof dataValue === 'object' ? dataValue : {}) as Row;
    const options = (optionsValue && typeof optionsValue === 'object' ? optionsValue : {}) as UpdateOptions;
    const context = options.context || {};
    const transaction = context.transaction || activeFileWrite.getStore();
    const isBoundFileFieldInsert = [...FILE_REFERENCE_FIELDS].some(key => {
      const [targetObject, field] = key.split('\u0000');
      return object === targetObject && field in data;
    }) && Boolean(transaction);
    if (isBoundFileFieldInsert) {
      return activeFileWrite.run(transaction, () => insert(objectValue, dataValue, options));
    }
    if (object === 'sys_file' && transaction && !context.transaction) {
      return insert(objectValue, dataValue, { ...options, context: { ...context, transaction } });
    }
    return insert(objectValue, dataValue, options);
  };
  mutable.update = async (objectValue, dataValue, optionsValue = {}) => {
    const object=String(objectValue||''),data=(dataValue&&typeof dataValue==='object'?dataValue:{}) as Row,options=(optionsValue&&typeof optionsValue==='object'?optionsValue:{}) as UpdateOptions;
    const context = options.context || {};
    const transaction = context.transaction || activeFileWrite.getStore();
    const isBoundFileFieldWrite = [...FILE_REFERENCE_FIELDS].some(key => {
      const [targetObject, field] = key.split('\u0000');
      return object === targetObject && field in data;
    }) && Boolean(context.transaction);
    if (isBoundFileFieldWrite) {
      return activeFileWrite.run(context.transaction, () => update(object, data, options));
    }
    if (object === 'sys_file' && transaction && !context.transaction) {
      return update(object, data, { ...options, context: { ...context, transaction } });
    }
    return update(object, data, options);
  };
  const inheritFileTransaction = (object: string, options: UpdateOptions = {}): UpdateOptions => {
    const transaction = options.context?.transaction || activeFileWrite.getStore();
    if (object !== 'sys_file' || !transaction || options.context?.transaction) return options;
    return { ...options, context: { ...options.context, transaction } };
  };
  mutable.find = (objectValue, query, optionsValue = {}) => {const object=String(objectValue||''),options=(optionsValue&&typeof optionsValue==='object'?optionsValue:{}) as UpdateOptions;return find(objectValue,query,inheritFileTransaction(object,options));};
  mutable.findOne = (objectValue, query, optionsValue = {}) => {const object=String(objectValue||''),options=(optionsValue&&typeof optionsValue==='object'?optionsValue:{}) as UpdateOptions;return findOne(objectValue,query,inheritFileTransaction(object,options));};
}

export class ServiceFileReferenceTransactionBridgePlugin implements Plugin {
  name = PACKAGE_ID;
  version = '1.0.0';
  type = 'standard' as const;

  init(): void {}

  start(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      installServiceFileReferenceTransactionBridge(ctx.getService<IObjectQLEngine>('objectql'));
    });
  }
}
