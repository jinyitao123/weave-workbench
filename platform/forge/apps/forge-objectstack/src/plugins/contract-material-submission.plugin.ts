import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import {
  CONTRACT_MATERIAL_SUBMISSION_TARGET,
  CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET,
  CONTRACT_SUBMISSION_RECEIPT_TARGET,
  readContractSubmissionReceipt,
  rejectRetiredRevisionAttachmentBinding,
  submitContractMaterialPackage,
} from './contract-material-submission.js';

const CONTRACT_OBJECT = 'forge_sales_contract';
const PACKAGE_OWNER = 'forge.contract.material-submission';

type Params = Record<string, unknown> & {
  primary_file_id?: unknown;
  material_file_ids?: unknown;
  material_file_id?: unknown;
  material_name?: unknown;
  material_sha256?: unknown;
  attachment_manifest?: unknown;
};
type HandlerContext = ActionHandlerContext<Params> & { recordLoadDenied?: boolean };

/** Registers trusted action targets; dispatch still enforces the declared action permission and caller record read. */
export class ContractMaterialSubmissionPlugin implements Plugin {
  name = 'com.inocube.forge.contract-material-submission';
  version = '1.0.0';
  type = 'standard' as const;

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const storage = ctx.getService<IStorageService>('storage');
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_MATERIAL_SUBMISSION_TARGET,
        (actionContext: HandlerContext) => submitContractMaterialPackage(engine, storage, actionContext), PACKAGE_OWNER);
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_SUBMISSION_RECEIPT_TARGET,
        (actionContext: HandlerContext) => readContractSubmissionReceipt(engine, actionContext), PACKAGE_OWNER);
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET,
        () => rejectRetiredRevisionAttachmentBinding(), PACKAGE_OWNER);
    });
  }
}
