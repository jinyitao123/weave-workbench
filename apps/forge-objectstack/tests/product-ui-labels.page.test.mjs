import assert from 'node:assert/strict';
import test from 'node:test';
import { forgeProductUiRuntime } from '../src/pages/product-ui.ts';
import { createServicePageHarness } from './service-page-react-harness.mjs';
function nodes(value,predicate){if(!value||typeof value!=='object')return[];return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate)):nodes(item,predicate))]}
for(const [component,props] of [['ForgeSelect',{id:'select-field',label:'Selection',value:'',options:[]}],['ForgeDateInput',{id:'date-field','aria-label':'Date',value:''}],['ForgeMultiSelectControl',{id:'multi-field','aria-label':'Multiple',value:[],children:[]}],['ForgeSingleSelectControl',{id:'single-field','aria-label':'Single',value:'',children:[]}]]){
 test(component+' preserves the host label target on its native or delegated trigger',()=>{
  const page={name:'label-controls',source:forgeProductUiRuntime+'\nexport default function App(){return '+component+'('+JSON.stringify(props)+')}'};
  const h=createServicePageHarness(page),tree=h.render();
  const trigger=nodes(tree,node=>node.type==='button'||node.type==='ForgeSelect')[0];
  assert.equal(trigger.props.id,props.id,'HTML labels must point to the actual trigger');
 });
}
