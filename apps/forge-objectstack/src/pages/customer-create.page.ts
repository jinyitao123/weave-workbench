import { definePage } from '@objectstack/spec/ui';
import { Contact, ContactChannel, Customer } from '../objects/customer.object.js';
import { ContactViews, CustomerViews } from '../views/customer.view.js';

const customerObjectName = Customer.name;
const contactObjectName = Contact.name;
const channelObjectName = ContactChannel.name;
const customerForm = CustomerViews.form;
const customerSections = customerForm?.sections ?? [];
const companySectionIndex = customerSections.findIndex((section) => section.name === 'company');
const customerHeaderSections = companySectionIndex < 0
  ? customerSections
  : customerSections.slice(0, companySectionIndex + 1);
const customerProfileSections = companySectionIndex < 0
  ? []
  : customerSections.slice(companySectionIndex + 1);
const customerFormColumns = customerForm?.columns ?? 4;
const contactParentField = Object.entries(Contact.fields)
  .find(([, field]) => field.type === 'lookup' && field.reference === customerObjectName)?.[0];
const channelParentField = Object.entries(ContactChannel.fields)
  .find(([, field]) => field.type === 'lookup' && field.reference === contactObjectName)?.[0];
if (!customerForm || !contactParentField || !channelParentField) {
  throw new Error('Customer creation requires the declared Customer form and both lookup relationships.');
}
const contactForm = ContactViews.form;
// The collection card supplies the heading; retain the View's field layout inside it.
const contactSections = (contactForm?.sections ?? [])
  .filter(section => section.name === 'contact_information')
  .map(({ name: _name, label: _label, ...section }) => section);
if (!contactForm || contactSections.length === 0) {
  throw new Error('Customer creation requires the declared Contact information form section.');
}
const contactInputFields = contactSections.flatMap(section =>
  (section.fields ?? []).map(field => typeof field === 'string' ? field : field.field));
const contactVisibleFields = [...contactInputFields, 'is_primary'];
if (contactVisibleFields.some((fieldName) => !Object.prototype.hasOwnProperty.call(Contact.fields, fieldName))) {
  throw new Error('Customer contact presentation references a field that is not declared on Contact.');
}

export const customerCreateRuntime = `
const CUSTOMER_OBJECT=${JSON.stringify(customerObjectName)};
const CONTACT_OBJECT=${JSON.stringify(contactObjectName)};
const CHANNEL_OBJECT=${JSON.stringify(channelObjectName)};
const CONTACT_PARENT_FIELD=${JSON.stringify(contactParentField)};
const CHANNEL_PARENT_FIELD=${JSON.stringify(channelParentField)};
const CUSTOMER_HEADER_SECTIONS=${JSON.stringify(customerHeaderSections)};
const CUSTOMER_PROFILE_SECTIONS=${JSON.stringify(customerProfileSections)};
const CUSTOMER_COLUMNS=${JSON.stringify(customerFormColumns)};
const CONTACT_INPUT_FIELDS=${JSON.stringify(contactInputFields)};
const CONTACT_VISIBLE_FIELDS=${JSON.stringify(contactVisibleFields)};
const CONTACT_SECTIONS=${JSON.stringify(contactSections)};
const CONTACT_COLUMNS=${JSON.stringify(contactForm?.columns ?? 4)};
const CONTACT_PRIMARY_FIELD='is_primary';
const CHANNEL_VALUE_FIELD='value';

const hasText=value=>typeof value==='string'&&value.trim().length>0;
const hasMeaningfulValue=value=>{
  if(typeof value==='string')return hasText(value);
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='boolean')return value;
  if(Array.isArray(value))return value.length>0;
  if(value&&typeof value==='object')return Object.keys(value).length>0;
  return value!==undefined&&value!==null;
};
const fieldsFor=sections=>Array.from(new Set((sections||[])
  .flatMap(section=>Array.isArray(section.fields)?section.fields:[])
  .map(field=>typeof field==='string'?field:field?.field)
  .filter(field=>typeof field==='string'&&field.length>0)));
const CUSTOMER_HEADER_FIELDS=fieldsFor(CUSTOMER_HEADER_SECTIONS);
const CUSTOMER_PROFILE_FIELDS=fieldsFor(CUSTOMER_PROFILE_SECTIONS);
const emptyChannels=contactKey=>[
  {draftKey:contactKey+'-mobile',values:{channel_type:'mobile',name:'工作手机',value:''}},
  {draftKey:contactKey+'-telephone',values:{channel_type:'telephone',name:'办公座机',value:''}},
  {draftKey:contactKey+'-email',values:{channel_type:'email',name:'工作邮箱',value:''}},
];

function CustomerCreateDialog({open,onOpenChange,onCreated}){
  const adapter=useAdapter();
  const initialContactKey='initial-primary-contact';
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [outcomeUnknown,setOutcomeUnknown]=React.useState(false);
  const [atomicStatus,setAtomicStatus]=React.useState('checking');
  const [customerValues,setCustomerValues]=React.useState({});
  const customerValuesRef=React.useRef(customerValues);
  customerValuesRef.current=customerValues;
  const [contacts,setContacts]=React.useState([{draftKey:initialContactKey,values:{[CONTACT_PRIMARY_FIELD]:true}}]);
  const contactsRef=React.useRef(contacts);
  contactsRef.current=contacts;
  const [channelsByContact,setChannelsByContact]=React.useState({[initialContactKey]:emptyChannels(initialContactKey)});
  const channelsByContactRef=React.useRef(channelsByContact);
  channelsByContactRef.current=channelsByContact;
  const companyController=React.useRef(null);
  const profileController=React.useRef(null);
  const contactsController=React.useRef(null);

  React.useEffect(()=>{
    let active=true;
    if(!adapter){
      setAtomicStatus('checking');
      return ()=>{active=false};
    }
    if(typeof adapter.supportsTransactionalBatch!=='function'||typeof adapter.batchTransaction!=='function'){
      setAtomicStatus('unavailable');
      return ()=>{active=false};
    }
    adapter.supportsTransactionalBatch()
      .then(supported=>{if(active)setAtomicStatus(supported===true?'available':'unavailable')})
      .catch(()=>{if(active)setAtomicStatus('unavailable')});
    return ()=>{active=false};
  },[adapter]);

  function updateCustomerValues(nextValues){
    const updated={...customerValuesRef.current,...nextValues};
    customerValuesRef.current=updated;
    setCustomerValues(updated);
    setError('');
  }

  function updateContacts(nextRows){
    const previous=contactsRef.current;
    const newlyPrimary=nextRows.find(row=>row.values?.[CONTACT_PRIMARY_FIELD]===true
      && previous.find(old=>old.draftKey===row.draftKey)?.values?.[CONTACT_PRIMARY_FIELD]!==true);
    const selectedPrimary=newlyPrimary?.draftKey
      || nextRows.find(row=>row.values?.[CONTACT_PRIMARY_FIELD]===true)?.draftKey
      || nextRows[0]?.draftKey;
    const normalized=nextRows.map(row=>({
      ...row,
      values:{...(row.values||{}),[CONTACT_PRIMARY_FIELD]:row.draftKey===selectedPrimary},
    }));
    contactsRef.current=normalized;
    setContacts(normalized);
    const updatedChannels=Object.fromEntries(normalized.map(row=>[
      row.draftKey,
      channelsByContactRef.current[row.draftKey]??emptyChannels(row.draftKey),
    ]));
    channelsByContactRef.current=updatedChannels;
    setChannelsByContact(updatedChannels);
    setError('');
  }

  function updateChannels(contactKey,nextRows){
    const updated={...channelsByContactRef.current,[contactKey]:nextRows};
    channelsByContactRef.current=updated;
    setChannelsByContact(updated);
    setError('');
  }

  function includeContact(row){
    const hasContactInput=CONTACT_INPUT_FIELDS.some(fieldName=>hasMeaningfulValue(row.values?.[fieldName]));
    const hasChannel=(channelsByContact[row.draftKey]??[]).some(channel=>hasText(channel.values?.[CHANNEL_VALUE_FIELD]));
    return hasContactInput||hasChannel;
  }

  function mergeValidationErrors(...results){
    return results.flatMap(result=>{
      if(result.valid)return [];
      if(Array.isArray(result.errors))return result.errors.map(item=>item.message).filter(Boolean);
      const messages=Object.values(result.errors||{}).filter(Boolean);
      if(result.formError)messages.push(result.formError);
      return messages;
    });
  }

  function buildOperations(customerData,contactDraft){
    if(contactDraft.parentObjectName!==CUSTOMER_OBJECT
      ||contactDraft.childObjectName!==CONTACT_OBJECT
      ||contactDraft.relationshipField!==CONTACT_PARENT_FIELD){
      throw new Error('客户联系人关系与已声明的对象模型不一致。');
    }
    const operations=[{object:CUSTOMER_OBJECT,action:'create',data:customerData}];
    const writablePrimaryRows=contactDraft.rows.filter(row=>
      Object.prototype.hasOwnProperty.call(row.values||{},CONTACT_PRIMARY_FIELD));
    const primaryContactKey=writablePrimaryRows.find(row=>row.values?.[CONTACT_PRIMARY_FIELD]===true)?.draftKey
      ||writablePrimaryRows[0]?.draftKey;
    for(const contactRow of contactDraft.rows){
      const contactValues={...(contactRow.values||{})};
      delete contactValues[CONTACT_PARENT_FIELD];
      // The controller has already stripped fields the actor cannot write.
      // Apply host primary policy only to the fields that survived that gate.
      if(Object.prototype.hasOwnProperty.call(contactValues,CONTACT_PRIMARY_FIELD)){
        contactValues[CONTACT_PRIMARY_FIELD]=contactRow.draftKey===primaryContactKey;
      }
      const contactOperationIndex=operations.length;
      operations.push({
        object:CONTACT_OBJECT,
        action:'create',
        data:{...contactValues,[contactDraft.relationshipField]:{$ref:0}},
      });
      const channelDraft=contactRow.children.find(group=>
        group.parentObjectName===CONTACT_OBJECT&&group.childObjectName===CHANNEL_OBJECT);
      if(!channelDraft||channelDraft.relationshipField!==CHANNEL_PARENT_FIELD){
        throw new Error('联系人联系方式草稿尚未通过完整校验。');
      }
      for(const channelRow of channelDraft.rows){
        const channelValues={...(channelRow.values||{})};
        delete channelValues[channelDraft.relationshipField];
        operations.push({
          object:CHANNEL_OBJECT,
          action:'create',
          data:{...channelValues,[channelDraft.relationshipField]:{$ref:contactOperationIndex}},
        });
      }
    }
    return operations;
  }

  async function createCustomer(){
    if(busy||outcomeUnknown)return;
    setBusy(true);
    setError('');
    let batchStarted=false;
    const draftSnapshot=JSON.stringify({
      customer:customerValuesRef.current,
      contacts:contactsRef.current,
      channels:channelsByContactRef.current,
    });
    try{
      if(!adapter||typeof adapter.supportsTransactionalBatch!=='function'||typeof adapter.batchTransaction!=='function'){
        setAtomicStatus('unavailable');
        setError('当前暂不可创建，请稍后重试或联系管理员。');
        return;
      }
      const transactionSupported=await adapter.supportsTransactionalBatch();
      if(transactionSupported!==true){
        setAtomicStatus('unavailable');
        setError('当前暂不可创建，请稍后重试或联系管理员。');
        return;
      }

      const company=companyController.current
        ?await companyController.current.validate()
        :{valid:false,errors:{},formError:'客户工商信息尚未加载完成。'};
      const profile=profileController.current
        ?await profileController.current.validate()
        :{valid:false,errors:{},formError:'客户资料尚未加载完成。'};
      const related=contactsController.current
        ?await contactsController.current.validate()
        :{valid:false,errors:[],formError:'联系人草稿尚未加载完成。'};
      if(!company.valid||!profile.valid||!related.valid){
        const messages=mergeValidationErrors(company,profile,related);
        setError(messages.join('；')||'请检查表单中标红的字段。');
        return;
      }
      const currentDraftSnapshot=()=>JSON.stringify({
        customer:customerValuesRef.current,
        contacts:contactsRef.current,
        channels:channelsByContactRef.current,
      });
      if(currentDraftSnapshot()!==draftSnapshot){
        setError('表单内容在校验期间发生变化，请重新检查后再创建。');
        return;
      }

      const parentValues={...company.values,...profile.values};
      const operations=buildOperations(parentValues,related.draft);
      // Re-check immediately before the only write. The adapter's advertised
      // capability selects its fail-closed path; this page never emulates it.
      if(await adapter.supportsTransactionalBatch()!==true){
        setAtomicStatus('unavailable');
        setError('当前暂不可创建，请稍后重试或联系管理员。');
        return;
      }
      if(currentDraftSnapshot()!==draftSnapshot){
        setError('表单内容在校验期间发生变化，请重新检查后再创建。');
        return;
      }
      batchStarted=true;
      const response=await adapter.batchTransaction(operations);
      const customerId=response?.results?.[0]?.id;
      if(typeof customerId!=='string'||!customerId){
        setOutcomeUnknown(true);
        setError('保存结果未能确认。为避免重复创建，草稿已保留且不能再次提交；请先到客户列表核对。');
        return;
      }
      onCreated?.(customerId);
    }catch(error){
      const status=Number(error?.httpStatus??error?.statusCode??error?.status);
      if(batchStarted&&(!Number.isFinite(status)||status>=500))setOutcomeUnknown(true);
      if(status===401)setError('登录状态已失效，请重新登录后继续。草稿仍保留。');
      else if(status===403)setError('当前账号无权创建客户、联系人或联系方式。草稿仍保留。');
      else if(status===400)setError('服务器拒绝了提交数据，请检查标红字段后重试。草稿仍保留。');
      else if(batchStarted&&(!Number.isFinite(status)||status>=500))setError('保存结果暂时无法确认。为避免重复创建，请先到客户列表核对；草稿仍保留。');
      else setError('客户资料未能保存。草稿仍保留，请核对后重试。');
    }finally{
      setBusy(false);
    }
  }

  function changeOpen(nextOpen){
    if(busy)return;
    onOpenChange?.(nextOpen);
  }

  const canSubmit=atomicStatus==='available'&&!busy&&!outcomeUnknown;
  return <CompositeDialog
    open={open}
    title="新增客户"
    onOpenChange={changeOpen}
    busy={busy}
    confirmOnDiscard={true}
    footer={({requestClose, busy:dialogBusy})=><div style={{display:'flex',justifyContent:'flex-end',gap:'var(--space-2)',alignItems:'center'}}>
      <button type="button" onClick={requestClose} disabled={dialogBusy} style={{height:'var(--ui-control-large-height,2.75rem)',padding:'0 var(--space-4)',border:'1px solid hsl(var(--border))',borderRadius:'var(--ui-control-radius,0.375rem)',background:'hsl(var(--background))',color:'hsl(var(--foreground))',fontSize:'var(--ui-control-font-size,0.875rem)'}}>取消</button>
      <button type="button" onClick={createCustomer} disabled={!canSubmit||dialogBusy} style={{height:'var(--ui-control-large-height,2.75rem)',padding:'0 var(--space-4)',border:'1px solid hsl(var(--primary))',borderRadius:'var(--ui-control-radius,0.375rem)',background:'hsl(var(--primary))',color:'hsl(var(--primary-foreground))',fontSize:'var(--ui-control-font-size,0.875rem)'}}>创建客户</button>
    </div>}
  >
    <div style={{display:'grid',gap:'var(--space-4)',pointerEvents:busy?'none':undefined}} aria-busy={busy}>
      {(!adapter||atomicStatus==='checking')&&<p role="status" style={{color:'hsl(var(--muted-foreground))'}}>正在加载创建表单…</p>}
      {atomicStatus==='unavailable'&&<p role="alert" style={{color:'hsl(var(--destructive))'}}>当前暂不可创建，请稍后重试或联系管理员。</p>}
      {error&&<p role="alert" style={{color:'hsl(var(--destructive))'}}>{error}</p>}
      {adapter&&<>
      <ObjectForm
        objectName={CUSTOMER_OBJECT}
        dataSource={adapter}
        mode="create"
        formType="simple"
        fields={CUSTOMER_HEADER_FIELDS}
        sections={CUSTOMER_HEADER_SECTIONS}
        columns={CUSTOMER_COLUMNS}
        showSubmit={false}
        showCancel={false}
        showReset={false}
        values={customerValues}
        onValuesChange={updateCustomerValues}
        onControllerReady={controller=>{companyController.current=controller;}}
        submitHandler={values=>{updateCustomerValues(values);return values;}}
      />
      <RelationshipCollectionEditor
        parentObjectName={CUSTOMER_OBJECT}
        childObjectName={CONTACT_OBJECT}
        dataSource={adapter}
        relationshipField={CONTACT_PARENT_FIELD}
        value={contacts}
        onChange={updateContacts}
        fields={CONTACT_VISIBLE_FIELDS}
        sections={CONTACT_SECTIONS}
        columns={CONTACT_COLUMNS}
        primaryField={CONTACT_PRIMARY_FIELD}
        parentRecord={customerValues}
        title="联系人"
        itemLabel="联系人"
        addLabel="添加联系人"
        removeLabel="移除"
        minRows={0}
        canRemoveRow={()=>contacts.length>1}
        includeRow={includeContact}
        onControllerReady={controller=>{contactsController.current=controller;}}
      >
        {({row,onControllerReady})=><RelationshipCollectionEditor
          parentObjectName={CONTACT_OBJECT}
          childObjectName={CHANNEL_OBJECT}
          relationshipField={CHANNEL_PARENT_FIELD}
          dataSource={adapter}
          value={channelsByContact[row.draftKey]??[]}
          onChange={nextRows=>updateChannels(row.draftKey,nextRows)}
          title="联系方式"
          itemLabel="联系方式"
          addLabel="添加联系方式"
          removeLabel="移除"
          minRows={0}
          presentation="rows"
          columns={3}
          fields={['channel_type','name','value']}
          fieldWidths={{channel_type:132,name:112}}
          parentRecord={row.values}
          includeRow={channel=>hasText(channel.values?.[CHANNEL_VALUE_FIELD])}
          createDraftValues={()=>({channel_type:'mobile',name:'工作手机'})}
          onControllerReady={onControllerReady}
        />}
      </RelationshipCollectionEditor>
      {CUSTOMER_PROFILE_SECTIONS.length>0&&<ObjectForm
        objectName={CUSTOMER_OBJECT}
        dataSource={adapter}
        mode="create"
        formType="simple"
        fields={CUSTOMER_PROFILE_FIELDS}
        sections={CUSTOMER_PROFILE_SECTIONS}
        columns={CUSTOMER_COLUMNS}
        showSubmit={false}
        showCancel={false}
        showReset={false}
        values={customerValues}
        onValuesChange={updateCustomerValues}
        onControllerReady={controller=>{profileController.current=controller;}}
        submitHandler={values=>{updateCustomerValues(values);return values;}}
      />}
      </>}
    </div>
  </CompositeDialog>;
}
`;

const source = `${customerCreateRuntime}
function App(){
  const [open,setOpen]=React.useState(true);
  return <CustomerCreateDialog
    open={open}
    onOpenChange={nextOpen=>setOpen(nextOpen)}
    onCreated={()=>setOpen(false)}
  />;
}
`;

export const CustomerCreatePage = definePage({
  name: 'page_customer_create',
  label: '新建客户',
  description: '创建客户及其联系人与联系方式',
  icon: 'building-2',
  type: 'app',
  kind: 'react',
  source,
});
