/** React source fragment embedded by the ProjectCenter source page. */
export function formatProjectAttachmentLocalDateTime(value: unknown): string {
  if (value == null || value === '') return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  try {
    // No timeZone override: render in the viewing browser's configured locale
    // and local zone, while leaving the stored ISO instant unchanged.
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return part('year') + '-' + part('month') + '-' + part('day') + ' ' + part('hour') + ':' + part('minute');
  } catch {
    return '—';
  }
}

const projectAttachmentPanelCss = `.pa-panel{display:grid;gap:12px}.pa-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.pa-field{min-height:var(--ui-control-height,28px);box-sizing:border-box;border:1px solid #cbd3dc;border-radius:var(--ui-control-radius,3.5px);padding:var(--ui-input-padding-y,3.5px) var(--ui-input-padding-x,10.5px);font-size:var(--ui-control-font-size,12.25px);line-height:var(--ui-control-line-height,17.5px)}.pa-select{flex:0 0 150px;min-width:150px}.pa-select .fp-picker-trigger{width:100%;height:var(--ui-control-height,28px);min-height:var(--ui-control-height,28px);border-radius:var(--ui-control-radius,3.5px);padding:var(--ui-input-padding-y,3.5px) var(--ui-input-padding-x,10.5px);font-size:var(--ui-control-font-size,12.25px);line-height:var(--ui-control-line-height,17.5px)}.pa-remarks{min-width:180px;flex:1}.pa-selected-file{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;color:hsl(var(--foreground));font-size:12.25px;line-height:17.5px}.pa-selected-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pa-selected-file-size{flex:0 0 auto;color:hsl(var(--muted-foreground));font-size:10.5px;line-height:14px}.pa-button{height:var(--ui-control-height,28px);border:1px solid #cbd3dc;border-radius:var(--ui-control-radius,3.5px);padding:0 var(--ui-button-padding-x,14px);background:#fff;font-size:var(--ui-control-font-size,12.25px);line-height:var(--ui-control-line-height,17.5px);cursor:pointer}.pa-button:disabled{opacity:.55;cursor:not-allowed}.pa-button.primary{background:#1769e0;border-color:#1769e0;color:#fff}.pa-error{color:#b42318}.pa-table{overflow:auto}.pa-table table{width:100%;min-width:560px;border-collapse:collapse;font-size:12px}.pa-table th,.pa-table td{padding:8px 10px;border-bottom:1px solid #edf0f3;text-align:left}.pa-table th{font-weight:600;background:#f8f9fb}.pa-file{color:#1769e0;text-decoration:none}.pa-file:hover{text-decoration:underline}.pa-muted{color:#7a8491;font-size:12px}`;
export const ProjectAttachmentPanelSource = `const projectAttachmentPanelCss=${JSON.stringify(projectAttachmentPanelCss)};\n${formatProjectAttachmentLocalDateTime.toString()}\n` + String.raw`
function ProjectAttachmentPanel({projectId,files=[],loading=false,loadError='',canUpload=false,request,onUploaded,resolveUserName=()=>''}) {
  const [selectedFile,setSelectedFile]=React.useState(null);
  const [category,setCategory]=React.useState('other');
  const [remarks,setRemarks]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [status,setStatus]=React.useState('');
  const [verifiedAttachment,setVerifiedAttachment]=React.useState(null);
  const inputRef=React.useRef(null);
  const categories={contract:'合同资料',technical:'技术资料',delivery:'交付资料',other:'其他资料'};
  function attachmentFile(row){const value=row&&row.attachment;return value&&typeof value==='object'?value:{id:typeof value==='string'?value:'',name:row?.name||''};}
  function normalizedResult(payload){let value=payload;for(let depth=0;depth<5&&value&&typeof value==='object';depth++){if(value.result!==undefined){value=value.result;continue;}if(value.data!==undefined){value=value.data;continue;}if(value.record!==undefined){value=value.record;continue;}break;}return value;}
  function selectedName(file){return String(file?.name||'').split(/[\\/]/).pop()||'未命名文件';}
  function humanFileSize(value){const bytes=Number(value);if(!Number.isFinite(bytes)||bytes<0)return'大小未知';if(bytes<1024)return Math.round(bytes)+' B';if(bytes<1024*1024)return(bytes/1024).toFixed(1)+' KB';if(bytes<1024*1024*1024)return(bytes/(1024*1024)).toFixed(1)+' MB';return(bytes/(1024*1024*1024)).toFixed(1)+' GB';}
  function errorText(value){const code=Number(value?.status||value?.statusCode||0);if(code===401)return'登录已失效，请重新登录后上传。';if(code===403||code===404)return'当前账号无法为此项目上传附件。';return String(value?.message||'附件上传失败，请检查文件后重试。');}
  React.useEffect(()=>{setVerifiedAttachment(null);},[projectId]);
  async function upload(event){event.preventDefault();if(busy)return;if(!projectId||typeof request!=='function'){setError('项目附件上传入口尚未就绪。');return;}if(!selectedFile){setError('请选择要上传的文件。');return;}setBusy(true);setError('');setStatus('');let actionCompleted=false;try{
    const prepared=await request('/storage/upload/presigned',{method:'POST',body:JSON.stringify({filename:selectedFile.name,mimeType:selectedFile.type||'application/octet-stream',size:selectedFile.size,scope:'user'})});
    const descriptor=prepared?.data||prepared;if(!descriptor?.fileId||!descriptor?.uploadUrl)throw new Error('存储服务没有返回上传地址。');
    const response=await fetch(new URL(descriptor.uploadUrl,window.location.origin),{method:descriptor.method||'PUT',headers:descriptor.headers||{},body:selectedFile});if(!response.ok)throw new Error('文件字节上传失败，请重试。');
    await request('/storage/upload/complete',{method:'POST',body:JSON.stringify({fileId:descriptor.fileId})});
    const actionPayload=await request('/actions/forge_project/project_attachment_create/'+encodeURIComponent(projectId),{method:'POST',body:JSON.stringify({params:{file_id:descriptor.fileId,category,remarks:remarks.trim()}})});actionCompleted=true;setSelectedFile(null);if(inputRef.current)inputRef.current.value='';
    const actionResult=normalizedResult(actionPayload),attachmentId=String(actionResult?.id||'').trim();if(!attachmentId)throw new Error('上传请求已完成，但服务端没有返回可核对的附件记录。');
    const readback=normalizedResult(await request('/data/forge_project_attachment/'+encodeURIComponent(attachmentId))),saved=readback?.record||readback;
    if(!saved||String(saved.id||'')!==attachmentId||String(saved.project_id||'')!==String(projectId)||String(saved.name||'')!==selectedName(selectedFile))throw new Error('当前账号无法核对刚上传的项目附件。');
    setVerifiedAttachment(saved);setRemarks('');setCategory('other');setStatus('附件已上传并可读取。');
    if(typeof onUploaded==='function'){try{await onUploaded(projectId);}catch{setError('附件已上传，但列表刷新失败；请重新读取项目附件。');}}
  }catch(value){setError(actionCompleted?'附件已上传，但当前账号无法读取保存结果。请联系项目管理员核对该项目的读取权限。':errorText(value));}finally{setBusy(false);}}
  const visibleFiles=Array.isArray(files)?files:[],listedIds=new Set(visibleFiles.map(row=>String(row?.id||''))),displayFiles=verifiedAttachment&&String(verifiedAttachment.project_id||'')===String(projectId)&&!listedIds.has(String(verifiedAttachment.id||''))?[...visibleFiles,verifiedAttachment]:visibleFiles;
  return <section className="pa-panel" aria-label="项目附件">
    <style>{projectAttachmentPanelCss}</style>
    {canUpload===true&&<form className="pa-toolbar" onSubmit={upload}>
      <input ref={inputRef} className="pa-field" type="file" aria-label="选择项目附件" onChange={event=>{setSelectedFile(event.target.files?.[0]||null);setError('');setStatus('');}} disabled={busy}/>
      <ForgeSelectControl className="pa-select" aria-label="资料分类" value={category} onChange={event=>setCategory(event.target.value)} disabled={busy}><option value="contract">合同资料</option><option value="technical">技术资料</option><option value="delivery">交付资料</option><option value="other">其他资料</option></ForgeSelectControl>
      <input className="pa-field pa-remarks" aria-label="备注" placeholder="备注" value={remarks} onChange={event=>setRemarks(event.target.value)} disabled={busy}/>
      <button className="pa-button primary" type="submit" disabled={busy||!selectedFile}>{busy?'正在上传…':'上传附件'}</button>
    </form>}
    {selectedFile&&<div className="pa-selected-file" aria-live="polite"><span className="pa-selected-file-name" title={selectedName(selectedFile)}>{selectedName(selectedFile)}</span><span className="pa-selected-file-size">{humanFileSize(selectedFile.size)}</span></div>}
    {error&&<div className="pa-error" role="alert">{error}</div>}{status&&<div role="status">{status}</div>}
    {loading?<div className="pa-muted" role="status">正在读取项目附件…</div>:loadError?<div className="pa-error" role="alert">项目附件读取失败，无法确认记录。</div>:displayFiles.length?<div className="pa-table"><table><thead><tr><th>文件名称</th><th>分类</th><th>上传人</th><th>上传时间</th></tr></thead><tbody>{displayFiles.map(row=>{const file=attachmentFile(row),url=file.url||(file.id?'/api/v1/storage/files/'+encodeURIComponent(file.id):'');return <tr key={row.id}><td>{url?<a className="pa-file" href={url} target="_blank" rel="noreferrer">{row.name||file.name||'未命名文件'}</a>:row.name||'未命名文件'}</td><td>{categories[row.category]||'其他资料'}</td><td>{resolveUserName(row.uploaded_by)||'—'}</td><td>{formatProjectAttachmentLocalDateTime(row.uploaded_at)}</td></tr>;})}</tbody></table></div>:<div className="pa-muted">暂无项目附件</div>}
  </section>;
}
`;
