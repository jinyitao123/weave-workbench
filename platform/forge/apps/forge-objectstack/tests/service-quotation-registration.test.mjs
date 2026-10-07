import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedForgeCoreBundle } from '../src/apps/shared-core.ts';
import { ObjectSchema } from '@objectstack/spec/data';
import { ActionSchema } from '@objectstack/spec/ui';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';

test('service draft object and Action are uniquely registered in the canonical shared package without CRUD grants', () => {
  assert.equal(sharedForgeCoreBundle.manifest.id, 'com.inoforge.forge.core');
  const objects = Object.values(sharedForgeCoreBundle.objects || {});
  const actions = Object.values(sharedForgeCoreBundle.actions || {});
  const receipts = objects.filter(object => object.name === 'forge_service_quotation_draft_receipt');
  const saves = actions.filter(action => action.name === 'service_quotation_save_draft');
  assert.equal(receipts.length, 1);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].objectName, 'forge_service_quotation');
  assert.ok(ObjectSchema.safeParse(receipts[0]).success);
  assert.ok(ActionSchema.safeParse(saves[0]).success);
  assert.deepEqual(saves[0].requiredPermissions, ['forge_service_manager']);
  assert.equal(receipts[0].sharingModel, 'controlled_by_parent');
  assert.equal(receipts[0].fields.quotation_id.reference, 'forge_service_quotation');
  assert.equal(receipts[0].fields.quotation_id.relatedList, false);
  assert.equal(serviceManagerPermission.objects.forge_service_quotation_draft_receipt, undefined);
  assert.equal(serviceOperatorPermission.objects.forge_service_quotation_draft_receipt, undefined);
  const parent = objects.find(object => object.name === 'forge_service_quotation');
  assert.equal(parent.fields.revision.hidden, true);
  assert.equal(parent.fields.revision.readonly, true);
  assert.equal(parent.fields.revision.defaultValue, 1);
});
