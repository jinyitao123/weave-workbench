import { ProjectBusinessDatePlugin } from './src/plugins/project-business-date.plugin.js';
import { OrganizationBusinessDateQueryPlugin } from './src/plugins/sales-performance-business-date.plugin.js';
import { SalesPerformanceCalendarPlugin } from './src/plugins/sales-performance-calendar.plugin.js';
import { ProjectRlsMembershipPlugin } from './src/plugins/project-rls-membership.plugin.js';
import { ProjectMemberMaintenancePlugin } from './src/plugins/project-member-maintenance.plugin.js';
import { ProjectWorkItemLifecyclePlugin } from './src/plugins/project-work-item-lifecycle.plugin.js';
import { ProjectApprovalFinalizationPlugin } from './src/plugins/project-approval-finalization.plugin.js';
import { SalesPerformanceApprovalFinalizationPlugin } from './src/plugins/sales-performance-approval-finalization.plugin.js';
import { projectAttachmentNativeActionsPlugin } from './src/apps/project-attachment-native-actions.js';
import { defineStack } from '@objectstack/spec';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { ServiceFileReferenceTransactionBridgePlugin } from './src/plugins/service-file-reference-transaction-bridge.plugin.js';
import { MCPServerPlugin } from '@objectstack/mcp';
import { TaskDelegationPlugin } from './src/plugins/task-delegation.plugin.js';
import { SalesOrderBusinessPlugin } from './src/plugins/sales-order-business.plugin.js';
import { SalesCrmMaintenanceReadPlugin } from './src/plugins/sales-crm-maintenance-read.plugin.js';
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
import { ProjectOrderBusinessPlugin } from './src/plugins/project-order-business.plugin.js';
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
    new ApprovalsServicePlugin({ recordReaderVisibleObjects: ['forge_sales_price_request', 'forge_sales_price_request_line', 'forge_sales_discount_request', 'forge_sales_additional_fee', 'forge_sales_additional_fee_line', 'forge_sales_contract', 'forge_sales_order', 'forge_sales_performance_confirmation', 'forge_sales_performance_rebook', 'forge_sales_performance_entry', 'forge_sales_performance_entry_source'] }),
    new SharingServicePlugin(),
    new ServiceFileReferenceTransactionBridgePlugin(),
    new ApprovalResubmitGuardPlugin({
      requiredMaterialObjects: ['forge_sales_contract'],
      verifierServiceName: 'forge.contract.revision.material',
    }),
    new SalesOrderBusinessPlugin(),
    new SalesCrmMaintenanceReadPlugin(),
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
    new ProjectApprovalFinalizationPlugin(),
    new SalesPerformanceApprovalFinalizationPlugin(),
    sharedForgeCorePlugin,
    projectAttachmentNativeActionsPlugin,
    ...forgeApplicationPlugins,
    new ProjectBusinessDatePlugin(),
    new OrganizationBusinessDateQueryPlugin(),
    new SalesPerformanceCalendarPlugin(),
    new ProjectRlsMembershipPlugin(),
    new ProjectMemberMaintenancePlugin(),
    new ProjectWorkItemLifecyclePlugin(),
    new ProjectMemberSharingPlugin(),
    new ProjectOrderBusinessPlugin(),
    new ServiceOrderReferenceSharingPlugin(),
  ],
});
