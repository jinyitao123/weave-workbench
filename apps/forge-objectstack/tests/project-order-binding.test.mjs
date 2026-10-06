import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProjectOperationBinding } from '../src/plugins/project-order-domain.ts';

test('server intent must match its exact durable operation and current locked record', () => {
  const who={userId:'employee',organizationId:'org',objectName:'forge_project',recordId:'project'};
  const binding={...who,actionName:'project_start',recordVersion:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',operationKey:'key',requestDigest:'b'.repeat(64)};
  const operation={operation_key:'key',user_id:who.userId,organization_id:who.organizationId,object_name:who.objectName,record_id:who.recordId,
    status:'in_progress',action_name:'forge:action:forge_project.project_start',request_digest:binding.requestDigest};
  assert.doesNotThrow(()=>assertProjectOperationBinding(binding,who,'project_start',operation,binding.recordVersion));
  for(const patch of [{userId:'another'},{organizationId:'another'},{objectName:'forge_customer'},{recordId:'another'},{actionName:'project_link_contract'},
    {recordVersion:'c'.repeat(64)},{expiresAt:'2000-01-01T00:00:00Z'},{expiresAt:'bad'},{operationKey:'another'},{requestDigest:'d'.repeat(64)}])
    assert.throws(()=>assertProjectOperationBinding({...binding,...patch},who,'project_start',operation,binding.recordVersion),error=>error.code==='EMPLOYEE_ACTION_CONTEXT_CHANGED');
  for(const patch of [{status:'unknown'},{status:'succeeded'},{user_id:'another'},{organization_id:'another'},{object_name:'forge_customer'},
    {record_id:'another'},{action_name:'forge:action:forge_project.project_link_contract'},{request_digest:'x'}])
    assert.throws(()=>assertProjectOperationBinding(binding,who,'project_start',{...operation,...patch},binding.recordVersion));
  assert.throws(()=>assertProjectOperationBinding(binding,who,'project_start',null,binding.recordVersion));
});
