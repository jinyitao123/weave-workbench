import { defineStack } from '@objectstack/spec';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { MCPServerPlugin } from '@objectstack/mcp';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { ApprovalWorkbenchContextPlugin } from './src/plugins/approval-workbench-context.plugin.js';
import { ApprovalResubmitGuardPlugin } from './src/plugins/approval-resubmit-guard.plugin.js';
import { ContractRevisionMaterialPlugin } from './src/plugins/contract-revision-material.js';
import { WeaveRunEventPlugin } from './src/plugins/weave-run-event.plugin.js';
import { forgeApplicationPlugins } from './src/apps/index.js';
import { sharedForgeCorePlugin } from './src/apps/shared-core.js';
export default defineStack({
  // Empty metadata collections tell the CLI host to mount ObjectQL and its
  // storage driver. The canonical business schema is carried by the explicit
  // sharedForgeCorePlugin below, so these stay empty and never duplicate it.
  objects: [],
  apps: [],
  pages: [],
  requires: ['automation', 'triggers', 'queue', 'approvals', 'messaging'],
  plugins: [
    new AutomationServicePlugin(),
    new MessagingServicePlugin(),
    new ApprovalsServicePlugin({ recordReaderVisibleObjects: ['forge_sales_contract'] }),
    new ApprovalResubmitGuardPlugin({
      requiredMaterialObjects: ['forge_sales_contract'],
      verifierServiceName: 'forge.contract.revision.material',
    }),
    new RecordChangeTriggerPlugin(),
    new MCPServerPlugin(),
    new WeaveRunEventPlugin(),
    new ApprovalWorkbenchContextPlugin(),
    new ContractRevisionMaterialPlugin(),
    sharedForgeCorePlugin,
    ...forgeApplicationPlugins,
  ],
});
