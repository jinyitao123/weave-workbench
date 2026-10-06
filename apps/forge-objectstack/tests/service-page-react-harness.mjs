import vm from 'node:vm';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url),cliRequire=createRequire(require.resolve('@objectstack/cli'));
const esbuild=cliRequire('esbuild');

/** Execute a real generated React Page source through its event handlers. */
export function createServicePageHarness(page,options={}){
  const {permissions=[],manager=false,records={},formValues,onAction=()=>({}),users={},transport,globals={}}=options;
  const code=esbuild.transformSync(page.source,{loader:'jsx',format:'cjs'}).code;
  const states=[],refs=[],effectDependencies=[],calls=[],forms=[],stateChanges=[];
  const effects=new Map(),effectCleanups=new Map();
  let cursor=0,pendingNetwork=0;
  const adapter={baseUrl:'http://service-page.test',fetchImpl:async(url,requestOptions={})=>{
    pendingNetwork++;
    try{
    const parsed=new URL(url),route=parsed.pathname.replace('/api/v1',''),path=route+parsed.search,method=String(requestOptions.method||'GET').toUpperCase(),body=requestOptions.body?JSON.parse(requestOptions.body):undefined;
    calls.push({path:parsed.pathname.replace('/api/v1',''),url:path,method,body});
    if(transport)return await transport(url,requestOptions);
    let payload={},status=200;
    if(path==='/auth/get-session')payload={user:{id:users.id||'service-page-actor'}};
    else if(path==='/auth/me/permissions')payload={systemPermissions:permissions};
    else if(path==='/actions/forge_service_order/service_order_manager_context'){
      if(manager)payload={canManage:true};else{status=403;payload={error:{message:'forbidden'}}}
    }else if(path.startsWith('/actions/'))payload=await onAction({path,method,body});
    else if(route.startsWith('/data/')){
      const segments=route.split('/'),objectName=segments[2],recordId=segments[3];
      if(recordId)payload=(records[objectName]||[]).find(record=>String(record.id)===decodeURIComponent(recordId))||null;
      else payload={records:records[objectName]||[],total:(records[objectName]||[]).length};
      if(recordId&&!payload){status=404;payload={error:{message:'record missing'}}}
    }
    return{ok:status<400,status,json:async()=>payload,headers:new Headers(),blob:async()=>new Blob()};
    }finally{pendingNetwork--;}
  }};
  const componentRenderers=new Map();
  function asNode(type,props,children=[]){return{type:typeof type==='function'?type.displayName||type.name:type,props:props||{},children:Array.isArray(children)?children.flat(Infinity):[children]}}
  const React={
    Fragment:'React.Fragment',
    createElement(type,props,...children){
      const normalized={...(props||{}),children:children.length?children.flat(Infinity):props&&props.children};
      const renderer=componentRenderers.get(type);
      return renderer?renderer(normalized):asNode(type,normalized,normalized.children||[]);
    },
    useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;stateChanges.push({index,value:states[index]})}]},
    useRef(initial){const index=cursor++;if(!(index in refs))refs[index]={current:initial};return refs[index]},
    useMemo(factory){cursor++;return factory()},
    useCallback(callback){cursor++;return callback},
    useEffect(callback,deps){const index=cursor++,previous=effectDependencies[index];if(!previous||!deps||deps.some((value,slot)=>!Object.is(value,previous[slot])))effects.set(index,callback);effectDependencies[index]=deps;},
  };
  function register(name,renderer){const component=props=>null;Object.defineProperty(component,'name',{value:name});componentRenderers.set(component,renderer);return component}
  const components={};
  components.ForgePageHeader=register('ForgePageHeader',props=>asNode('ForgePageHeader',props,[props.actions,props.children]));
  components.Icon=register('Icon',props=>asNode('Icon',props,[]));
  components.WorkspaceHeader=register('WorkspaceHeader',props=>asNode('WorkspaceHeader',props,[props.action,props.children]));
  components.WorkspaceToolbar=register('WorkspaceToolbar',props=>asNode('WorkspaceToolbar',props,[props.search,props.filters,...(props.primaryActionPlacement==='start'?[props.primaryAction,props.auxiliaryActions]:[props.auxiliaryActions,props.primaryAction]),props.children]));
  components.StatusTabs=register('StatusTabs',props=>asNode('StatusTabs',props,props.children||[]));
  components.ListSummary=register('ListSummary',props=>asNode('ListSummary',props,(props.items||[]).flatMap(item=>[item.label,item.value])));
  components.CategoryDistribution=register('CategoryDistribution',props=>asNode('CategoryDistribution',props,(props.items||[]).flatMap(item=>[item.label,item.value])));
  components.RecordTable=register('RecordTable',props=>{
    const schema=props.schema||{},rows=Array.isArray(schema.data)?schema.data:[],columns=schema.columns||[];
    const rowNodes=rows.map(row=>{
      const cells=columns.map(column=>typeof column.cell==='function'?column.cell(row[column.accessorKey],row):row[column.accessorKey]);
      return asNode('div',{key:row.id},cells);
    });
    return asNode('RecordTable',props,rowNodes);
  });
  components.CompositeDialog=register('CompositeDialog',props=>{
    const footer=typeof props.footer==='function'?props.footer({requestClose:()=>{},busy:props.busy===true}):props.footer;
    return asNode('CompositeDialog',props,[props.children,footer]);
  });
  components.DocumentWorkspace=register('DocumentWorkspace',props=>asNode('DocumentWorkspace',props,[props.main,props.sidebar,props.footer]));
  components.ObjectForm=register('ObjectForm',props=>{
    forms.push(props);
    props.onControllerReady?.({validate:async()=>({valid:true,values:typeof formValues==='function'?formValues(props):formValues??props.values??{}})});
    return asNode('ObjectForm',props,[]);
  });
  components.ListView=register('ListView',props=>{
    const objectName=props.data&&props.data.object,rows=records[objectName]||[];
    return asNode('ListView',props,rows.map(row=>asNode('button',{type:'button','data-record-id':row.id,onClick:()=>props.onRowClick?.(row)},[row.code||row.name||row.id])));
  });
  for(const name of ['ForgeNotice','ForgeLoading','ForgeEmpty','DataEmptyState','ObjectMetric','ObjectChart','ForgeSelect','ForgeSelectControl','ForgeDateInput','GridField','DocumentSection'])components[name]=register(name,props=>asNode(name,props,props.children||[]));
  const context={module:{exports:{}},exports:{},React,useAdapter:()=>adapter,URL,URLSearchParams,Headers,Blob,TextEncoder,window:{crypto:{randomUUID:()=>`service-page-key-${calls.length}`}},...components,...globals};
  context.exports=context.module.exports;
  vm.runInNewContext(code,context);
  const exportedDefault=context.module.exports?.default||context.exports?.default;
  const component=exportedDefault||(page.source.trimStart().startsWith('function App(')?context.App:null);
  if(typeof component!=='function')throw new Error(`React page source ${page.name||'(unnamed)'} must export a default component or declare a leading implicit function App`);
  // An observation render must not discard effects queued by the preceding
  // event. Keep the latest callback per hook until the harness commits it.
  function render(){cursor=0;return component()}
  async function waitForNetwork(){for(let attempt=0;pendingNetwork>0&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,10));if(pendingNetwork>0)throw new Error('Page source request did not settle in the test harness');await new Promise(resolve=>setImmediate(resolve))}
  async function flushEffects(){let tree=render();for(let attempt=0;attempt<8;attempt++){const pending=[...effects.entries()];effects.clear();if(!pending.length)return tree;pending.forEach(([index,effect])=>{effectCleanups.get(index)?.();const cleanup=effect();if(typeof cleanup==='function')effectCleanups.set(index,cleanup);else effectCleanups.delete(index)});await waitForNetwork();tree=render()}return tree}
  async function settle(){await waitForNetwork();return render()}
  return{render,flushEffects,settle,calls,forms,states,stateChanges,component,usesDefaultExport:typeof exportedDefault==='function'};
}

export function serviceNodes(tree,predicate){if(!tree||typeof tree!=='object')return[];const props=tree.props||{},nested=[...(tree.children||[]),...(Array.isArray(props.actions)?props.actions:[props.actions]),...(Array.isArray(props.children)?props.children:[props.children])];return[...(predicate(tree)?[tree]:[]),...nested.flatMap(child=>serviceNodes(child,predicate))]}
export function serviceText(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);return(tree&&tree.children||[]).map(serviceText).join('')}
export function serviceButton(tree,label,occurrence=0){return serviceNodes(tree,node=>node.type==='button'&&serviceText(node).trim()===label)[occurrence]}
