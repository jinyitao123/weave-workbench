import { defineStack } from '@objectstack/spec';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { ServiceFileReferenceTransactionBridgePlugin } from './src/plugins/service-file-reference-transaction-bridge.plugin.js';
import { MCPServerPlugin } from '@objectstack/mcp';
import { TaskDelegationPlugin } from './src/plugins/task-delegation.plugin.js';
import { SalesOrderBusinessPlugin } from './src/plugins/sales-order-business.plugin.js';
import { EmployeeBusinessActionPlugin } from './src/plugins/employee-business-action.plugin.js';
import { WorkbenchInboxPlugin } from './src/plugins/workbench-inbox.plugin.js';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { ApprovalWorkbenchContextPlugin } from './src/plugins/approval-workbench-context.plugin.js';
import { ApprovalResubmitGuardPlugin } from './src/plugins/approval-resubmit-guard.plugin.js';
import { ContractRevisionMaterialPlugin } from './src/plugins/contract-revision-material.js';
import { ContractMaterialSubmissionPlugin } from './src/plugins/contract-material-submission.plugin.js';
import { WeaveRunEventPlugin } from './src/plugins/weave-run-event.plugin.js';
import { WorkbenchOwnedMaterialPlugin } from './src/plugins/workbench-owned-material.plugin.js';
import { ApprovalWorkListPlugin } from './src/plugins/approval-work-list.plugin.js';
import { ProjectMemberSharingPlugin } from './src/plugins/project-member-sharing.plugin.js';
import { ServiceOrderReferenceSharingPlugin } from './src/plugins/service-order-reference-sharing.plugin.js';
import { forgeApplicationPlugins } from './src/apps/index.js';
import { sharedForgeCorePlugin } from './src/apps/shared-core.js';
export default defineStack({
  // Empty metadata collections tell the CLI host to mount ObjectQL and its
  // storage driver. The canonical business schema is carried by the explicit
  // sharedForgeCorePlugin below, so these stay empty and never duplicate it.
  objects: [],
  apps: [],
  pages: [],
  requires: ['automation', 'triggers', 'queue', 'approvals', 'messaging', 'sharing'],
  plugins: [
    new AutomationServicePlugin(),
    new MessagingServicePlugin(),
    new ApprovalsServicePlugin({ recordReaderVisibleObjects: ['forge_sales_contract', 'forge_sales_order'] }),
    new SharingServicePlugin(),
    new ServiceFileReferenceTransactionBridgePlugin(),
    new ApprovalResubmitGuardPlugin({
      requiredMaterialObjects: ['forge_sales_contract'],
      verifierServiceName: 'forge.contract.revision.material',
    }),
    new SalesOrderBusinessPlugin(),
    new RecordChangeTriggerPlugin(),
    new MCPServerPlugin(),
    new WorkbenchInboxPlugin(),
    new TaskDelegationPlugin(),
    new EmployeeBusinessActionPlugin(),
    new WeaveRunEventPlugin(),
    new WorkbenchOwnedMaterialPlugin(),
    new ApprovalWorkListPlugin(),
    new ApprovalWorkbenchContextPlugin(),
    new ContractRevisionMaterialPlugin(),
    new ContractMaterialSubmissionPlugin(),
    sharedForgeCorePlugin,
    ...forgeApplicationPlugins,
    new ProjectMemberSharingPlugin(),
    new ServiceOrderReferenceSharingPlugin(),
  ],
});
