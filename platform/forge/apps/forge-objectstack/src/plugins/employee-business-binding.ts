import { AsyncLocalStorage } from 'node:async_hooks';

export interface EmployeeBusinessBinding {
  userId: string; organizationId: string; objectName: string; recordId: string;
  actionName: string; recordVersion: string; expiresAt: string; operationKey: string; requestDigest: string;
  file?: { parameter: string; fileId: string; name: string; mediaType: string; bytes: number; sha256: string };
}

// Server-only dispatch scope. Never populated from Action params or retained by
// an approval/notification callback. Closing the call also closes inherited
// async work, so a later callback cannot reuse the employee's intent.
const active = new AsyncLocalStorage<{ binding: Readonly<EmployeeBusinessBinding>; open: boolean }>();
export async function withEmployeeBusinessBinding<T>(binding: EmployeeBusinessBinding, run: () => Promise<T>): Promise<T> {
  const scope = { binding: Object.freeze({ ...binding, ...(binding.file ? { file: Object.freeze({ ...binding.file }) } : {}) }), open: true };
  return active.run(scope, async () => { try { return await run(); } finally { scope.open = false; } });
}
export function employeeBusinessBinding(): Readonly<EmployeeBusinessBinding> | undefined {
  const scope = active.getStore();
  return scope?.open ? scope.binding : undefined;
}
