import type { IObjectQLEngine, ISharingService, ShareSource } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/** List the exact native provenance, without the public listShares 500-row ceiling. */
export async function revokeProjectionShares(
  engine:IObjectQLEngine,
  sharing:ISharingService,
  projection:{object:string;recordId:string;recipientId:string;source:ShareSource;sourceId:string},
  context:ExecutionContext,
):Promise<void> {
  if(context.isSystem!==true||!context.tenantId||!projection.object||!projection.recordId||!projection.recipientId||!projection.sourceId)throw new Error('分享撤销缺少明确的来源与组织范围');
  const where={organization_id:context.tenantId,object_name:projection.object,record_id:projection.recordId,recipient_type:'user',recipient_id:projection.recipientId,source:projection.source,source_id:projection.sourceId};
  // Read all IDs before deleting so offset pagination cannot skip removed rows.
  const ids:string[]=[];
  for(let offset=0;;offset+=200){const rows=await engine.find('sys_record_share',{where,limit:200,offset,orderBy:[{field:'id',order:'asc'}]},{context});ids.push(...rows.map(row=>String(row.id)));if(rows.length<200)break}
  for(const id of ids)await sharing.revoke(id,context,{object:projection.object,recordId:projection.recordId});
}
