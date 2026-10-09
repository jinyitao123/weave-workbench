import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as customerCreatePageModule from '../src/pages/customer-create.page.ts';
import { Contact, ContactChannel, Customer } from '../src/objects/customer.object.ts';
import { ContactViews, CustomerViews } from '../src/views/customer.view.ts';

const { CustomerCreatePage, customerCreateRuntime } = customerCreatePageModule;

test('customer composite page is a valid React Page using the declared Customer form sections', () => {
  assert.equal(CustomerCreatePage.type, 'app');
  assert.equal(CustomerCreatePage.kind, 'react');
  assert.ok(CustomerCreatePage.source.length > 0);
  assert.ok(CustomerCreatePage.source.startsWith(customerCreateRuntime));
  assert.match(customerCreateRuntime, /function CustomerCreateDialog\(\{open,onOpenChange,onCreated\}\)/);
  assert.equal(Object.hasOwn(customerCreatePageModule, 'default'), false);
  assert.doesNotMatch(CustomerCreatePage.source, /export default|navigate\(/);
  const sections = CustomerViews.form.sections;
  const splitIndex = sections.findIndex((section) => section.name === 'company');
  assert.ok(CustomerCreatePage.source.includes(JSON.stringify(sections.slice(0, splitIndex + 1))));
  assert.ok(CustomerCreatePage.source.includes(JSON.stringify(sections.slice(splitIndex + 1))));

  const transpiled = ts.transpileModule(CustomerCreatePage.source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  assert.deepEqual(syntaxErrors, []);
});

test('customer composite save uses only the declared atomic batch adapter and prior-operation references', () => {
  assert.match(CustomerCreatePage.source, /supportsTransactionalBatch\(\)/);
  assert.match(CustomerCreatePage.source, /adapter\.batchTransaction\(operations\)/);
  assert.match(CustomerCreatePage.source, /\$ref:0/);
  assert.match(CustomerCreatePage.source, /CHANNEL_PARENT_FIELD=/);
  assert.match(CustomerCreatePage.source, /fields=\{\['channel_type','name','value'\]\}/);
  assert.doesNotMatch(CustomerCreatePage.source, /adapter\.(?:create|update)\(/);
  assert.doesNotMatch(CustomerCreatePage.source, /\/api\/v1\/batch/);
  assert.doesNotMatch(CustomerCreatePage.source, /原子保存|transactionalBatch|正在确认保存能力/);
  assert.doesNotMatch(CustomerCreatePage.source, /\._id/);
});

test('customer batch host policy does not restore a primary field stripped by permissions or readonly rules', () => {
  const start = customerCreateRuntime.indexOf('function buildOperations(');
  const end = customerCreateRuntime.indexOf('async function createCustomer()', start);
  const build = new Function(
    'CUSTOMER_OBJECT', 'CONTACT_OBJECT', 'CHANNEL_OBJECT', 'CONTACT_PARENT_FIELD', 'CHANNEL_PARENT_FIELD', 'CONTACT_PRIMARY_FIELD',
    customerCreateRuntime.slice(start, end) + '\nreturn buildOperations;',
  )(Customer.name, Contact.name, ContactChannel.name, 'customer_id', 'contact_id', 'is_primary');
  const rows = [
    { draftKey: 'restricted', values: { name: 'Restricted field contact' } },
    { draftKey: 'writable', values: { name: 'Writable field contact', is_primary: false } },
  ].map(row => ({ ...row, children: [{
    parentObjectName: Contact.name, childObjectName: ContactChannel.name,
    relationshipField: 'contact_id', rows: [],
  }] }));
  const operations = build({ name: 'Equipment customer' }, {
    parentObjectName: Customer.name, childObjectName: Contact.name,
    relationshipField: 'customer_id', rows,
  });
  assert.equal(Object.hasOwn(operations[1].data, 'is_primary'), false);
  assert.equal(operations[2].data.is_primary, true);
  assert.deepEqual(operations[1].data.customer_id, { $ref: 0 });
});

function createPageHarness(adapter) {
  const hooks = [];
  let cursor = 0;
  let renderEffects = [];
  const createdIds = [];
  const openChanges = [];
  const ObjectForm = function ObjectForm() {};
  const RelationshipCollectionEditor = function RelationshipCollectionEditor() {};
  const CompositeDialog = function CompositeDialog() {};
  const React = {
    createElement(type, props, ...children) {
      const nextProps = { ...(props ?? {}) };
      if (children.length === 1) nextProps.children = children[0];
      else if (children.length > 1) nextProps.children = children;
      return { type, props: nextProps };
    },
    useState(initialValue) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [hooks[slot], (nextValue) => {
        hooks[slot] = typeof nextValue === 'function' ? nextValue(hooks[slot]) : nextValue;
      }];
    },
    useRef(initialValue) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = { current: initialValue };
      return hooks[slot];
    },
    useEffect(effect) {
      cursor++;
      if (renderEffects.length === 0) renderEffects.push(effect);
    },
  };
  const compiled = ts.transpileModule(`${CustomerCreatePage.source}\nreturn CustomerCreateDialog;`, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const CustomerCreateDialog = new Function(
    'useAdapter', 'React', 'ObjectForm', 'RelationshipCollectionEditor', 'CompositeDialog',
    compiled,
  )(
    () => adapter,
    React,
    ObjectForm,
    RelationshipCollectionEditor,
    CompositeDialog,
  );
  const render = () => {
    cursor = 0;
    return CustomerCreateDialog({
      open: true,
      onOpenChange: (nextOpen) => openChanges.push(nextOpen),
      onCreated: (customerId) => createdIds.push(customerId),
    });
  };
  const runEffects = async () => {
    for (const effect of renderEffects) effect();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { render, runEffects, createdIds, openChanges, ObjectForm, RelationshipCollectionEditor, CompositeDialog };
}

function findElements(root, predicate, found = []) {
  if (!root || typeof root !== 'object') return found;
  if (predicate(root)) found.push(root);
  const children = root.props?.children;
  if (Array.isArray(children)) children.forEach((child) => findElements(child, predicate, found));
  else if (children && typeof children !== 'function') findElements(children, predicate, found);
  return found;
}

test('customer page validates both controlled parent sections and sends one referenced batch', async () => {
  const batchCalls = [];
  const adapter = {
    async supportsTransactionalBatch() { return true; },
    async batchTransaction(operations) {
      batchCalls.push(operations);
      return { results: [{ id: 'customer-created' }] };
    },
  };
  const harness = createPageHarness(adapter);
  let page = harness.render();
  await harness.runEffects();
  page = harness.render();

  const forms = findElements(page, (element) => element.type === harness.ObjectForm);
  assert.equal(forms.length, 2);
  assert.ok(forms.every((form) => form.props.dataSource === adapter));
  forms[0].props.onControllerReady({
    async validate() { return { valid: true, values: { name: 'Acme', category_id: 'category-1' } }; },
  });
  forms[1].props.onControllerReady({
    async validate() { return { valid: true, values: { industry: 'Equipment' } }; },
  });
  const collection = findElements(page, (element) => element.type === harness.RelationshipCollectionEditor)[0];
  assert.equal(collection.props.canRemoveRow(), false);
  assert.equal(collection.props.includeRow({
    draftKey: 'initial-primary-contact',
    values: { is_primary: true, employment_status: 'active' },
  }), false);
  assert.equal(collection.props.includeRow({
    draftKey: 'initial-primary-contact',
    values: { is_primary: true, employment_status: 'inactive' },
  }), false);
  assert.equal(collection.props.includeRow({
    draftKey: 'initial-primary-contact',
    values: { name: 'Ada', is_primary: true, employment_status: 'active' },
  }), true);
  assert.deepEqual(collection.props.fields, ['name', 'job_title', 'gender', 'department', 'decision_weight', 'remarks', 'is_primary']);
  assert.deepEqual(collection.props.sections, ContactViews.form.sections
    .filter(section => section.name === 'contact_information')
    .map(({ name, label, ...section }) => section));
  assert.equal(collection.props.primaryField, 'is_primary');

  const nested = collection.props.children({
    row: { draftKey: 'initial-primary-contact', values: { is_primary: true } },
    onControllerReady() {},
  });
  assert.equal(nested.props.relationshipField, Object.keys(ContactChannel.fields).find((fieldName) =>
    ContactChannel.fields[fieldName].type === 'lookup' && ContactChannel.fields[fieldName].reference === Contact.name));
  assert.deepEqual(nested.props.fields, ['channel_type', 'name', 'value']);
  assert.equal(nested.props.includeRow({ values: { channel_type: 'email', name: 'Work email', value: ' ' } }), false);
  assert.equal(nested.props.includeRow({ values: { channel_type: 'email', name: 'Work email', value: 'ada@example.com' } }), true);

  const contactField = Object.keys(Contact.fields).find((fieldName) =>
    Contact.fields[fieldName].type === 'lookup' && Contact.fields[fieldName].reference === Customer.name);
  const relatedController = {
    async validate() {
      return {
        valid: true,
        draft: {
          parentObjectName: Customer.name,
          childObjectName: Contact.name,
          relationshipField: contactField,
          rows: [{
            draftKey: 'initial-primary-contact',
            values: { name: 'Ada', is_primary: true, job_title: 'Buyer' },
            children: [{
              parentObjectName: Contact.name,
              childObjectName: ContactChannel.name,
              relationshipField: nested.props.relationshipField,
              rows: [{
                draftKey: 'work-email',
                values: { channel_type: 'email', name: 'Work email', value: 'ada@example.com' },
              }],
            }],
          }],
        },
      };
    },
  };
  collection.props.onControllerReady(relatedController);

  let closeRequests = 0;
  const footer = page.props.footer({ requestClose() { closeRequests += 1; }, busy: false });
  const buttons = findElements(footer, (element) => element.type === 'button');
  buttons[0].props.onClick();
  assert.equal(closeRequests, 1);
  await buttons[1].props.onClick();

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0], [
    {
      object: Customer.name,
      action: 'create',
      data: { name: 'Acme', category_id: 'category-1', industry: 'Equipment' },
    },
    {
      object: Contact.name,
      action: 'create',
      data: { name: 'Ada', is_primary: true, job_title: 'Buyer', [contactField]: { $ref: 0 } },
    },
    {
      object: ContactChannel.name,
      action: 'create',
      data: { channel_type: 'email', name: 'Work email', value: 'ada@example.com', [nested.props.relationshipField]: { $ref: 1 } },
    },
  ]);
  assert.deepEqual(harness.createdIds, ['customer-created']);
  assert.deepEqual(harness.openChanges, []);
});
