import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, ISharingService, IStorageService } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { revokeTerminalContractReviewShares } from './contract-review-sharing.js';
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
  dependencies = ['com.objectstack.service.sharing'];

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const storage = ctx.getService<IStorageService>('storage');
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_MATERIAL_SUBMISSION_TARGET,
        (actionContext: HandlerContext) => submitContractMaterialPackage(engine, storage, actionContext, ctx.getService<ISharingService>('sharing')), PACKAGE_OWNER);
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_SUBMISSION_RECEIPT_TARGET,
        (actionContext: HandlerContext) => readContractSubmissionReceipt(engine, actionContext), PACKAGE_OWNER);
      engine.registerAction(CONTRACT_OBJECT, CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET,
        () => rejectRetiredRevisionAttachmentBinding(), PACKAGE_OWNER);
      engine.registerHook('afterUpdate', hook => revokeTerminalContractReviewShares(engine, ctx.getService<ISharingService>('sharing'), hook as HookContext), {
        object: CONTRACT_OBJECT, priority: 180, packageId: PACKAGE_OWNER,
      });
    });
  }
}
