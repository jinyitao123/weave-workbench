import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

const source = `
function App(){
  const adapter=useAdapter();
  const query=new URLSearchParams(window.location.search);
  const projectId=query.get('project')||'';
  const memberId=query.get('member')||'';
  const [state,setState]=React.useState({loading:true,loadError:'',error:'',businessDateError:'',project:null,member:null,users:[],currentUserId:'',systemPermissions:[],positionData:null,positionError:''});
  const [form,setForm]=React.useState({user_id:'',joined_on:'',remarks:'',position_ids:[],default_position_id:''});
  const [savedForm,setSavedForm]=React.useState({user_id:'',joined_on:'',remarks:'',position_ids:[],default_position_id:''});
  const [busy,setBusy]=React.useState(false);
  const writeInFlight=React.useRef(false);
  const pendingReadback=React.useRef(null);
  const [dialog,setDialog]=React.useState(null);
  async function request(path,options={}){
    const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(field=>field.message||field.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');
    return payload;
  }
  async function find(object,where){return ForgeReadAllRecords(adapter,object,{filter:where,orderBy:'id asc',label:'项目成员资料'});}
  async function load(options){
    const readback=options||pendingReadback.current||{};
    pendingReadback.current=readback;
    if(!projectId){setState(current=>({...current,loading:false,loadError:'缺少当前项目，无法维护项目团队。'}));return;}
    setState(current=>({...current,loading:true,loadError:'',error:'',notice:''}));
    try{
      const [sessionPayload,permissionPayload,projects,members,users,businessDateResult]=await Promise.all([
        request('/auth/get-session'),request('/auth/me/permissions'),find('forge_project',{id:projectId}),find('forge_project_member',{project_id:projectId}),find('sys_user'),
        memberId?Promise.resolve({date:'',error:''}):ForgeOrganizationBusinessDate(adapter).then(date=>({date,error:''})).catch(error=>({date:'',error:String(error.message||error)})),
      ]);
      const session=sessionPayload.data||sessionPayload,permissions=permissionPayload.data||permissionPayload,project=projects[0]||null;
      if(!project)throw new Error('项目不存在或当前账号无权读取。');
      const member=memberId?members.find(row=>row.id===memberId)||null:null;
      if(memberId&&!member)throw new Error('项目成员不存在或不属于当前项目。');
      let positionData=null,positionError='';
      if(member){try{const payload=await request('/actions/forge_project_member/project_member_position_assignments_read/'+encodeURIComponent(member.id),{method:'POST',body:JSON.stringify({recordId:member.id,params:{}})});positionData=payload?.result||payload?.data?.result||payload?.data||payload;}catch(error){positionError=String(error.message||error)}}
      if(readback.notice&&positionError)throw new Error(positionError);
      const activeAssignments=Array.isArray(positionData?.assignments)?positionData.assignments.filter(row=>row.active===true&&row.appointed===true):[];
      const loadedForm={user_id:member?.user_id||'',joined_on:String(member?.joined_on||businessDateResult.date||'').slice(0,10),remarks:member?.remarks||'',position_ids:activeAssignments.map(row=>row.positionId).filter(Boolean),default_position_id:activeAssignments.find(row=>row.isDefault)?.positionId||''};
      setState({loading:false,loadError:'',error:'',notice:readback.notice||'',businessDateError:businessDateResult.error,project,member,users,currentUserId:session.user?.id||session.session?.user?.id||'',systemPermissions:Array.isArray(permissions.systemPermissions)?permissions.systemPermissions:[],positionData,positionError});
      setForm(current=>({...loadedForm,...(readback.preserveMemberDraft?{user_id:current.user_id,joined_on:current.joined_on,remarks:current.remarks}:{}),...(readback.preservePositionDraft?{position_ids:current.position_ids,default_position_id:current.default_position_id}:{})}));
      setSavedForm(loadedForm);pendingReadback.current=null;
    }catch(error){setState(current=>({...current,loading:false,loadError:(readback.notice?'保存已完成，但最新资料读取失败：':'')+String(error.message||error)}));}
  }
  React.useEffect(()=>{load();},[]);
  function userName(userId){const user=state.users.find(row=>row.id===userId);return user?(user.display_name||user.name||user.username||'未命名账号'):'当前成员';}
  const managerMember=Boolean(state.member&&(state.member.member_duty==='manager'||state.member.user_id===state.project?.manager_id));
  const inactiveMember=Boolean(state.member&&state.member.active!==true);
  const canManage=Boolean(state.project&&state.systemPermissions.includes('forge_project_operator')&&(state.project.owner_id===state.currentUserId||state.project.manager_id===state.currentUserId));
  const readOnly=!canManage||managerMember||inactiveMember;
  const eligibleUsers=state.users.filter(user=>user.id!==state.project?.manager_id&&user.active!==false&&user.banned!==true);
  function backToProject(){const href=forgePageHref('page_project_center');if(!href)return;const query=new URLSearchParams();query.set('project',projectId);query.set('tab','team');ForgeNavigate(href+'?'+query.toString());}
  const memberInfoChanged=form.user_id!==savedForm.user_id||form.joined_on!==savedForm.joined_on||form.remarks!==savedForm.remarks;
  const hasUnsavedChanges=memberInfoChanged||form.default_position_id!==savedForm.default_position_id||form.position_ids.slice().sort().join('|')!==savedForm.position_ids.slice().sort().join('|');
  const positionsChanged=form.default_position_id!==savedForm.default_position_id||form.position_ids.slice().sort().join('|')!==savedForm.position_ids.slice().sort().join('|');
  function cancelEditing(){if(busy||writeInFlight.current)return;if(hasUnsavedChanges)setDialog({kind:'discard',error:''});else backToProject();}
  function discardEditing(){if(busy||writeInFlight.current)return;setDialog(null);backToProject();}
  async function save(){
    if(readOnly||busy||writeInFlight.current)return;
    if(!form.joined_on)return setState(current=>({...current,error:'请填写加入日期。'}));
    if(!memberId&&!form.user_id)return setState(current=>({...current,error:'请选择项目成员。'}));
    const addParams={user_id:form.user_id,member_duty:'member',joined_on:form.joined_on,remarks:form.remarks.trim()||null};
    const editParams={expected_updated_at:state.member?.updated_at,joined_on:form.joined_on,remarks:form.remarks.trim()||null};
    const path=memberId
      ?'/actions/forge_project_member/project_member_update/'+encodeURIComponent(memberId)
      :'/actions/forge_project/project_member_add/'+encodeURIComponent(projectId);
    writeInFlight.current=true;setBusy(true);setState(current=>({...current,error:'',notice:''}));
    try{
      await request(path,{method:'POST',body:JSON.stringify({params:memberId?editParams:addParams})});
      if(memberId&&positionsChanged)await load({preservePositionDraft:true,notice:'成员信息已保存，岗位分配修改尚未保存。'});
      else backToProject();
    }catch(error){setState(current=>({...current,error:String(error.message||error)}));}finally{writeInFlight.current=false;setBusy(false);}
  }
  async function savePositions(){
    if(busy||writeInFlight.current||!memberId||!state.member||!canManage||managerMember||inactiveMember||state.positionError||!state.positionData)return;
    if(form.default_position_id&&!form.position_ids.includes(form.default_position_id))return setState(current=>({...current,error:'默认岗位必须包含在已选择的项目岗位中。'}));
    writeInFlight.current=true;setBusy(true);setState(current=>({...current,error:'',notice:''}));
    try{await request('/actions/forge_project_member/project_member_position_assignments_save/'+encodeURIComponent(memberId),{method:'POST',body:JSON.stringify({recordId:memberId,params:{expected_updated_at:state.member.updated_at,position_ids:JSON.stringify(form.position_ids),default_position_id:form.default_position_id||null}})});await load({preserveMemberDraft:memberInfoChanged,notice:memberInfoChanged?'岗位分配已保存，成员信息修改尚未保存。':'岗位分配已保存。'});}
    catch(error){setState(current=>({...current,error:String(error.message||error)}));}finally{writeInFlight.current=false;setBusy(false);}
  }
  async function removeMember(){
    if(busy||writeInFlight.current||readOnly||!memberId||!state.member)return;
    writeInFlight.current=true;setBusy(true);setState(current=>({...current,error:'',notice:''}));
    try{
      await request('/actions/forge_project_member/project_member_deactivate/'+encodeURIComponent(memberId),{method:'POST',body:JSON.stringify({params:{expected_updated_at:state.member.updated_at}})});
      setDialog(null);backToProject();
    }catch(error){setDialog(current=>({...current,error:String(error.message||error)}));}finally{writeInFlight.current=false;setBusy(false);}
  }
  function renderConfirmation(){return <ForgeDialog open={!!dialog} title={dialog?.kind==='discard'?'放弃未保存修改':'移出项目成员'} subtitle={dialog?.kind==='discard'?'项目团队':userName(state.member?.user_id)} error={dialog?.error} busy={busy} danger={dialog?.kind!=='discard'} confirmLabel={dialog?.kind==='discard'?'放弃修改':'确认移出'} onCancel={()=>!busy&&setDialog(null)} onConfirm={dialog?.kind==='discard'?discardEditing:removeMember}>{dialog?.kind==='discard'?<div className="fp-dialog-impact">返回项目会丢弃尚未保存的成员信息和岗位分配。</div>:<div className="fp-dialog-impact">该成员将在本项目中停用，历史关系保留。项目负责人不能移出。</div>}</ForgeDialog>;}
  const css=\`${forgeProductUiCss}.forge-project-member-editor{min-height:100%;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif}.pme-shell{width:min(820px,100%);margin:0 auto;padding:22px}.pme-crumb{font-size:var(--ui-control-font-size,12px);color:#667085;margin-bottom:14px}.pme-muted{color:#667085;font-size:var(--ui-control-font-size,12px)}.pme-card{background:#fff;border:1px solid #e4e8f0;border-radius:var(--ui-card-radius,10px);padding:18px;margin-bottom:14px}.pme-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px}.pme-field{min-width:0}.pme-field label{display:block;margin-bottom:6px;color:#475467;font-size:var(--ui-label-font-size,12px);line-height:var(--ui-label-line-height,normal);font-weight:560}.pme-field input,.pme-field textarea{box-sizing:border-box;width:100%;border:1px solid #d5dbe6;border-radius:var(--ui-control-radius,7px);background:#fff;color:#172033;padding:var(--ui-input-padding-y,9px) var(--ui-input-padding-x,11px);font:inherit;font-size:var(--ui-control-font-size,inherit);line-height:var(--ui-control-line-height,normal)}.pme-field input{height:var(--ui-control-height,36px)}.pme-field textarea{min-height:var(--ui-textarea-min-height,82px);resize:vertical}.pme-field .readonly{display:flex;align-items:center;min-height:var(--ui-control-height,36px);padding:0 var(--ui-input-padding-x,10px);border:1px solid #e4e8f0;border-radius:var(--ui-control-radius,7px);background:#f8f9fc;color:#475467}.pme-span-2{grid-column:1/-1}.pme-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.pme-notice{padding:10px 12px;border-radius:8px;background:#fff3cd;color:#745600;margin-bottom:12px;font-size:var(--ui-control-font-size,12px)}.pme-error{padding:10px 12px;border-radius:8px;background:#fff0ef;color:#b42318;margin-bottom:12px;font-size:var(--ui-control-font-size,12px)}@media(max-width:680px){.pme-shell{padding:12px}.pme-fields{grid-template-columns:1fr}.pme-span-2{grid-column:auto}.pme-head{display:block}.pme-head .pme-actions{margin-top:12px}}\`;
  if(state.loading)return <div className="forge-project-member-editor"><style>{css}</style><div className="pme-shell">正在读取项目团队…</div></div>;
  const title=memberId?'编辑项目成员':'添加项目成员';
  if(state.loadError)return <div className="forge-project-member-editor"><style>{css}</style><div className="pme-shell"><div className="pme-crumb">项目 / 项目团队</div><WorkspaceHeader title={title} action={<button type="button" className="fp-button" disabled={busy} onClick={cancelEditing}>返回项目</button>}/><div className="pme-error" role="alert">项目成员资料读取失败：{state.loadError}</div><button type="button" className="fp-button" onClick={()=>load()}>重新读取资料</button></div>{renderConfirmation()}</div>;
  const memberRole=state.member?.member_duty==='manager'?'项目经理':'项目成员';
  return <div className="forge-project-member-editor"><style>{css}</style><div className="pme-shell">
    <div className="pme-crumb">项目 / {state.project?.name||'项目团队'}</div>
    <WorkspaceHeader title={title} action={<button type="button" className="fp-button" disabled={busy} onClick={cancelEditing}>返回项目</button>}/>
    {state.error&&<div className="pme-error" role="alert">{state.error}</div>}
    {state.notice&&<div className="pme-notice" role="status">{state.notice}</div>}
    {!memberId&&state.businessDateError&&<div className="pme-error" role="alert">组织业务日期读取失败，不能自动填入加入日期：{state.businessDateError}</div>}
    {!canManage&&<div className="pme-notice" role="status">当前账号只能查看项目团队；只有本项目所有者或项目经理可维护成员。</div>}
    {managerMember&&<div className="pme-notice" role="status">项目负责人关系由项目负责人字段维护，不能在普通成员编辑器中修改或移除。</div>}
    {inactiveMember&&<div className="pme-notice" role="status">该项目成员关系已停用；如需重新加入，请从“添加项目成员”重新启用同一账号关系。</div>}
    <div className="pme-card"><div className="pme-fields">
      <div className="pme-field"><label>项目</label><div className="readonly">{state.project?.name||'—'}{state.project?.code?' · '+state.project.code:''}</div></div>
      <div className="pme-field"><label>项目角色</label><div className="readonly">{memberId?memberRole:'项目成员'}</div></div>
      {memberId
        ? <div className="pme-field pme-span-2"><label>成员账号</label><div className="readonly">{userName(state.member?.user_id)}</div></div>
        : <div className="pme-field pme-span-2"><label htmlFor="project-member-user">成员账号 *</label><ForgeSelectControl aria-label="项目成员账号" value={form.user_id} onChange={event=>setForm(current=>({...current,user_id:event.target.value}))} disabled={busy||!canManage}><option value="">请选择组织内账号</option>{eligibleUsers.map(user=><option key={user.id} value={user.id}>{user.display_name||user.name||user.username||'未命名账号'}</option>)}</ForgeSelectControl></div>}
      <div className="pme-field"><label htmlFor="project-member-joined-on">加入日期 *</label><ForgeDateInput aria-label="成员加入日期" value={form.joined_on} onChange={event=>setForm(current=>({...current,joined_on:event.target.value}))} disabled={busy||readOnly}/></div>
      <div className="pme-field pme-span-2"><label htmlFor="project-member-remarks">备注</label><textarea aria-label="项目成员备注" value={form.remarks} onChange={event=>setForm(current=>({...current,remarks:event.target.value}))} disabled={busy||readOnly}/></div>
    </div><div className="pme-actions">{memberId&&state.member?.member_duty==='member'&&<button type="button" className="fp-button danger" disabled={busy||readOnly||state.member?.active!==true} onClick={()=>setDialog({kind:'remove',error:''})}>移出项目</button>}<button type="button" className="fp-button primary" disabled={busy||readOnly||!form.joined_on||(!memberId&&!form.user_id)||(!!memberId&&!memberInfoChanged)} onClick={save}>{memberId?'保存成员信息':'保存'}</button></div></div>
    {memberId&&<div className="pme-card"><h2>项目岗位</h2><p className="pme-muted">仅可选择成员当前有效的岗位。</p>{state.positionError&&<div className="pme-notice" role="alert">岗位目录读取失败：{state.positionError}</div>}{managerMember&&<div className="pme-notice" role="status">项目负责人变更通过负责人交接办理，不能在成员页面更改岗位。</div>}{state.positionData&&<><div className="pme-field pme-span-2"><label>当前组织岗位（可多选）</label><ForgeSelectControl aria-label="项目岗位（可多选）" multiple value={form.position_ids} onChange={event=>{const positionIds=Array.isArray(event.target.value)?event.target.value:[];setForm(current=>({...current,position_ids:positionIds,default_position_id:positionIds.includes(current.default_position_id)?current.default_position_id:''}))}} disabled={!canManage||managerMember||inactiveMember||busy||!!state.positionError}><option value="">请选择当前组织有效岗位</option>{(state.positionData.available_positions||[]).map(position=><option key={position.id} value={position.id}>{position.label}{position.modules?.length?' · '+position.modules.join('、'):''}</option>)}</ForgeSelectControl>{(state.positionData.assignments||[]).some(assignment=>assignment.active&&!assignment.appointed)&&<div className="pme-muted">存在已失效的组织任职；历史分配保留，但不再提供项目访问范围。</div>}{!(state.positionData.available_positions||[]).length&&!state.positionError&&<div className="pme-muted">该成员当前没有可分配的组织岗位。</div>}</div><div className="pme-field"><label>默认项目岗位</label><ForgeSelectControl aria-label="默认项目岗位" value={form.default_position_id} onChange={event=>setForm(current=>({...current,default_position_id:event.target.value}))} disabled={!canManage||managerMember||inactiveMember||busy||!!state.positionError}><option value="">不设置默认岗位</option>{(state.positionData.available_positions||[]).filter(position=>form.position_ids.includes(position.id)).map(position=><option key={position.id} value={position.id}>{position.label}</option>)}</ForgeSelectControl></div><div className="pme-actions"><button type="button" className="fp-button primary" disabled={busy||!canManage||managerMember||inactiveMember||!!state.positionError||!state.positionData||!positionsChanged} onClick={savePositions}>保存岗位分配</button></div></>}</div>}
    {renderConfirmation()}
  </div></div>;
}
`;

export const ProjectMemberEditorPage = { name: 'page_project_member_editor', label: '项目成员维护', description: '维护当前项目的普通成员关系', icon: 'users', type: 'app' as const, template: 'react-source' as const, kind: 'react' as const, source: source + forgeProductUiRuntime };
