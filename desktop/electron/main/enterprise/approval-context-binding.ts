import type { EnterpriseApprovalContext, EnterpriseApprovalContextView } from '../../../src/types/api'
import { digest } from './handoff-store'

export function currentItemContextFingerprint(context: EnterpriseApprovalContext): string {
  return digest(JSON.stringify({
    requestId: context.requestId, status: context.status, viewer: context.viewer, title: context.title, step: context.step,
    businessObject: context.businessObject, sourceMaterialVersion: context.sourceMaterialVersion,
    availableActions: context.availableActions ?? null,
    returnVersion: context.returnVersion, returnReason: context.returnReason, fields: context.fields,
    files: context.files.map(({ fileId, name, mediaType, bytes, sha256 }) => ({ fileId, name, mediaType, bytes, sha256 })),
    originalFiles: context.originalFiles?.map(({ sourceKind, requestId, fileId, name, mediaType, bytes, sha256 }) => ({ sourceKind, requestId, fileId, name, mediaType, bytes, sha256 })),
  }))
}

export function approvalUiChoices(context: EnterpriseApprovalContext): Pick<EnterpriseApprovalContextView, 'actionVersion' | 'actions'> {
  if (context.status !== 'pending' || context.viewer !== 'current_approver' || context.availableActions === undefined) return {}
  return {
    actionVersion: currentItemContextFingerprint(context),
    actions: context.availableActions.filter((action) => Boolean(action.semantic)).map((action) => ({
      actionRef: digest(JSON.stringify(action)), semantic: action.semantic!, label: action.label,
    })),
  }
}
