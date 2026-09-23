import type { Plugin, PluginContext } from '@objectstack/core';
import type {
  ApprovalActionRow,
  ApprovalRequestRow,
  ApprovalResubmitInput,
  ApprovalResubmitResult,
  IApprovalService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

export interface ResubmitMaterialBinding {
  bindingId: string;
  returnVersion: string;
  sourceMaterialVersion: string;
  newVersionDigest: string;
}

export interface GuardedApprovalResubmitInput extends ApprovalResubmitInput {
  materialBinding?: ResubmitMaterialBinding;
  idempotencyKey?: string;
}

export interface ResubmitMaterialVerificationInput {
  request: ApprovalRequestRow;
  actorId: string;
  materialBinding: ResubmitMaterialBinding;
  idempotencyKey: string;
  context: ExecutionContext;
}

export interface ApprovalResubmitGuardOptions {
  /** Objects whose approval flows require a Forge-validated material binding. */
  requiredMaterialObjects: readonly string[];
  /** Read-only check against the current request and the Forge binding ledger. */
  verifyMaterialBinding?: (input: ResubmitMaterialVerificationInput) => Promise<boolean>;
  /** Forge service slot that supplies the same read-only verifier at call time. */
  verifierServiceName?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function latestReturnVersion(actions: ApprovalActionRow[]): string | undefined {
  return [...actions].reverse().find((action) => action.action === 'revise')?.id;
}

function validationFailure(message: string): Error {
  return new Error(`VALIDATION_FAILED: ${message}`);
}

/**
 * Installs a fail-closed policy at the kernel's `approvals` service slot.
 * The native approval service still owns request state and resumes the same
 * flow; this plugin adds Forge's per-object material gate before delegation.
 *
 * ObjectStack 17.3's built-in REST route resolves `approvals` from the service
 * slot for every request, so it reaches this wrapper. The route currently only
 * forwards actor/comment; material-bearing calls must use the trusted service
 * path until the host route exposes the additional binding fields.
 *
 * This guard does not claim or consume bindings. Transaction ownership and
 * recovery after an uncertain resume also remain separate acceptance work.
 */
export class ApprovalResubmitGuardPlugin implements Plugin {
  name = 'com.inocube.forge.approval-resubmit-guard';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.approvals'];

  private readonly requiredMaterialObjects: Set<string>;
  private readonly verifyMaterialBinding?: ApprovalResubmitGuardOptions['verifyMaterialBinding'];
  private readonly verifierServiceName?: string;

  constructor(options: ApprovalResubmitGuardOptions) {
    this.requiredMaterialObjects = new Set(options.requiredMaterialObjects);
    this.verifyMaterialBinding = options.verifyMaterialBinding;
    this.verifierServiceName = options.verifierServiceName;
  }

  init(): void {}

  start(ctx: PluginContext): void {
    const native = ctx.getService<IApprovalService>('approvals');
    const guardedResubmit = async (
      requestId: string,
      input: GuardedApprovalResubmitInput,
      context: ExecutionContext,
    ): Promise<ApprovalResubmitResult> => {
      const request = await native.getRequest(requestId, context);
      if (!request || !this.requiredMaterialObjects.has(request.object_name)) {
        return native.resubmit(requestId, input, context);
      }

      // Preserve the native NOT_FOUND / INVALID_STATE / wrong-submitter
      // results. The required-object gate only runs for this submitter's
      // current returned request.
      if (request.status !== 'returned') return native.resubmit(requestId, input, context);
      const actorId = context.userId;
      if (!actorId) {
        if (context.isSystem) {
          throw new Error('FORBIDDEN: material resubmission requires the authenticated submitter');
        }
        return native.resubmit(requestId, input, context);
      }
      if (request.submitter_id !== actorId) return native.resubmit(requestId, input, context);

      const binding = input?.materialBinding;
      const idempotencyKey = input?.idempotencyKey;
      if (!binding || !idempotencyKey) {
        throw validationFailure('a material binding and idempotency key are required for this approval');
      }
      if (!UUID.test(binding.bindingId) || !UUID.test(idempotencyKey) ||
          !SHA256.test(binding.sourceMaterialVersion) || !SHA256.test(binding.newVersionDigest)) {
        throw validationFailure('the material binding identifiers or SHA-256 values are invalid');
      }

      const actions = await native.listActions(requestId, context);
      const returnVersion = latestReturnVersion(actions);
      if (!returnVersion || binding.returnVersion !== returnVersion) {
        throw validationFailure('the material binding does not match the latest return decision');
      }
      if (binding.sourceMaterialVersion !== await sha256(request.payload)) {
        throw validationFailure('the material binding does not match the returned source version');
      }
      let verify = this.verifyMaterialBinding;
      if (!verify && this.verifierServiceName) {
        try {
          const service = ctx.getService<{ verifyBinding: (input: ResubmitMaterialVerificationInput) => Promise<boolean> }>(this.verifierServiceName);
          verify = (verification) => service.verifyBinding(verification);
        } catch {
          // The guard must stay closed until the domain verifier is available.
        }
      }
      if (!verify) {
        throw validationFailure('Forge material validation is not configured for this approval');
      }
      if (!await verify({ request, actorId, materialBinding: binding, idempotencyKey, context })) {
        throw validationFailure('Forge rejected the submitted material version');
      }

      // The authenticated session is authoritative; ignore a body-supplied
      // actorId on the required-material service path.
      return native.resubmit(requestId, { actorId, comment: input.comment }, context);
    };

    const replacement = new Proxy(native, {
      get(target, property) {
        if (property === 'resubmit') return guardedResubmit;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    ctx.replaceService('approvals', replacement);
  }
}
