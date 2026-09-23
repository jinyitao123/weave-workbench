import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { censusArtifacts } from '../scripts/feature-census.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../scripts/feature-census.mjs');

const salesArtifact = {
  manifest: { id: 'com.example.sales', name: 'sales', namespace: 'example' },
  objects: [
    { name: 'root_shared', label: '共享对象' },
    { name: 'native_target', label: '原生对象' },
    { name: 'duplicate_obj', label: '重复对象一' },
    { name: 'duplicate_obj', label: '重复对象二' },
  ],
  pages: [
    { name: 'native_target', label: '同名页面' },
    { name: 'page_repeat', label: '可复用页面' },
    { name: 'page_reports_gap', label: '报表入口占位' },
    { name: 'page_under_review', label: '待复核功能', status: 'review_required' },
  ],
  dashboards: [{ name: 'dashboard_main', label: '经营总览' }],
  reports: [{ name: 'report_profit', label: '利润表' }],
  actions: [{ name: 'sales_submit', label: '提交销售单' }],
  apps: [{
    name: 'sales',
    label: '销售应用',
    areas: [{
      id: 'sales_ops',
      label: '销售业务',
      navigation: [{
        id: 'sales_group',
        type: 'group',
        label: '销售处理',
        children: [
          { id: 'native_object', type: 'object', label: '原生对象入口', objectName: 'native_target' },
          { id: 'root_shared', type: 'object', label: '共享对象入口', objectName: 'root_shared' },
          { id: 'plugin_object', type: 'object', label: '插件对象入口', objectName: 'plugin_target' },
          { id: 'deep_plugin_object', type: 'object', label: '深层插件对象入口', objectName: 'deep_target' },
          { id: 'duplicate_object', type: 'object', label: '重复定义对象', objectName: 'duplicate_obj' },
          { id: 'missing_object', type: 'object', label: '缺定义对象', objectName: 'missing_object' },
          { id: 'page_repeat_a', type: 'page', label: '复用页面入口一', pageName: 'page_repeat', params: { nav: 'page_repeat_a' } },
          { id: 'page_repeat_b', type: 'page', label: '复用页面入口二', pageName: 'page_repeat', params: { nav: 'page_repeat_b' } },
          { id: 'placeholder_page', type: 'page', label: '报表', pageName: 'page_reports_gap' },
          { id: 'page_pending_review', type: 'page', label: '待复核入口', pageName: 'page_under_review' },
          { id: 'missing_page', type: 'page', label: '缺定义页面', pageName: 'page_not_registered' },
          { id: 'dashboard', type: 'dashboard', label: '总览', dashboardName: 'dashboard_main' },
          { id: 'report', type: 'report', label: '利润', reportName: 'report_profit' },
          { id: 'action', type: 'action', label: '提交', actionDef: { actionName: 'sales_submit' } },
          { id: 'missing_action', type: 'action', label: '缺失动作', actionDef: { actionName: 'not_registered' } },
          { id: 'component', type: 'component', label: '对象目录', componentRef: 'metadata:directory' },
          { id: 'external', type: 'url', label: '官网', url: 'https://example.invalid' },
          { id: 'divider', type: 'separator' },
        ],
      }],
    }],
  }],
  plugins: [{
    name: 'shared-object-plugin',
    bundle: {
      objects: [{ name: 'plugin_target', label: '插件对象' }],
      plugins: [{
        name: 'nested-plugin',
        bundle: {
          plugins: [{
            name: 'deep-nested-plugin',
            bundle: { objects: [{ name: 'deep_target', label: '深层对象' }] },
          }],
        },
      }],
    },
  }],
};

const extensionArtifact = {
  manifest: { id: 'com.example.extension', name: 'extension', namespace: 'example' },
  objects: [{ name: 'plugin_target', label: '扩展包同名对象' }],
  pages: [{ name: 'page_repeat', label: '扩展包同名页面' }],
  apps: [{
    name: 'extension',
    label: '扩展应用',
    areas: [{
      id: 'extension_ops',
      label: '扩展',
      navigation: [
        { id: 'shared_ref', type: 'object', label: '引用共享对象', objectName: 'root_shared' },
        { id: 'collision_ref', type: 'object', label: '包内对象', objectName: 'plugin_target' },
        { id: 'collision_page', type: 'page', label: '包内页面', pageName: 'page_repeat' },
      ],
    }],
  }],
};

const findEntry = (ledger, application, navigationId) => ledger.entries.find((entry) =>
  entry.application === application && entry.navigationId === navigationId);

test('reads navigation leaves and resolves against recursive global definitions', () => {
  const ledger = censusArtifacts([
    { source: 'sales.json', artifact: salesArtifact },
    { source: 'extension.json', artifact: extensionArtifact },
  ]);

  const native = findEntry(ledger, 'sales', 'native_object');
  assert.equal(native.targetKind, 'object');
  assert.equal(native.targetName, 'native_target');
  assert.equal(native.definitionStatus, 'registered-in-package');
  assert.deepEqual(native.navigationGroup, ['销售业务', '销售处理']);
  assert.equal(native.registered, true);
  assert.equal(ledger.directory.objects.some((item) => item.name === 'native_target'), true);
  assert.equal(ledger.directory.pages.some((item) => item.name === 'native_target'), true);

  const pluginObject = findEntry(ledger, 'sales', 'plugin_object');
  assert.equal(pluginObject.definitionStatus, 'registered-in-package');
  assert.equal(pluginObject.crossPackageNameCollisionCandidate, true);
  assert.deepEqual(pluginObject.definitionPackageScopes, ['com.example.extension', 'com.example.sales']);

  const deepPluginObject = findEntry(ledger, 'sales', 'deep_plugin_object');
  assert.equal(deepPluginObject.definitionStatus, 'registered-in-package');
  assert.equal(ledger.directory.objects.some((item) => item.name === 'deep_target'), true);

  assert.equal(findEntry(ledger, 'sales', 'dashboard').registered, true);
  assert.equal(findEntry(ledger, 'sales', 'report').registered, true);
  assert.equal(findEntry(ledger, 'sales', 'action').registered, true);

  const rootSharedReference = findEntry(ledger, 'extension', 'shared_ref');
  assert.equal(rootSharedReference.registered, true);
  assert.equal(rootSharedReference.definitionStatus, 'registered-in-other-package');
  assert.deepEqual(rootSharedReference.definitionPackageScopes, ['com.example.sales']);
});

test('reports missing, duplicate, cross-package and placeholder candidates without business verdicts', () => {
  const ledger = censusArtifacts([
    { source: 'sales.json', artifact: salesArtifact },
    { source: 'extension.json', artifact: extensionArtifact },
  ]);

  const missing = findEntry(ledger, 'sales', 'missing_object');
  assert.equal(missing.registered, false);
  assert.equal(missing.definitionStatus, 'missing-definition');
  assert.equal(missing.businessVerified, 'unknown');

  const duplicateDefinition = findEntry(ledger, 'sales', 'duplicate_object');
  assert.equal(duplicateDefinition.registered, true);
  assert.equal(duplicateDefinition.definitionStatus, 'duplicate-in-package-candidate');
  assert.equal(duplicateDefinition.samePackageDuplicateDefinitionCandidate, true);

  const repeatedPages = ledger.entries.filter((entry) =>
    entry.application === 'sales' && entry.target === 'page:page_repeat');
  assert.equal(repeatedPages.length, 2);
  assert.ok(repeatedPages.every((entry) => entry.samePackageDuplicateTargetCandidate));
  assert.ok(repeatedPages.every((entry) => entry.samePackageTargetOccurrenceCount === 2));
  assert.ok(repeatedPages.every((entry) => entry.sameApplicationTargetOccurrenceCount === 2));
  assert.ok(repeatedPages.every((entry) => entry.crossPackageNameCollisionCandidate));
  assert.ok(repeatedPages.every((entry) => entry.businessVerified === 'unknown'));

  const placeholder = findEntry(ledger, 'sales', 'placeholder_page');
  assert.equal(placeholder.registered, true);
  assert.equal(placeholder.placeholderCandidate, true);
  assert.equal(placeholder.businessVerified, 'unknown');

  const missingAction = findEntry(ledger, 'sales', 'missing_action');
  assert.equal(missingAction.registered, false);
  assert.equal(missingAction.definitionStatus, 'missing-definition');

  const missingPage = findEntry(ledger, 'sales', 'missing_page');
  assert.equal(missingPage.registered, false);
  assert.equal(missingPage.definitionStatus, 'missing-definition');

  const pendingReview = findEntry(ledger, 'sales', 'page_pending_review');
  assert.equal(pendingReview.registered, true);
  assert.equal(pendingReview.placeholderCandidate, false);
  assert.equal(pendingReview.businessVerified, 'unknown');

  const component = findEntry(ledger, 'sales', 'component');
  assert.equal(component.registered, null);
  assert.equal(component.definitionStatus, 'runtime-registry-not-contained-in-artifact');
  assert.equal(component.businessVerified, 'unknown');

  assert.equal(ledger.entries.some((entry) => entry.navigationId === 'external'), false);
  assert.equal(ledger.entries.some((entry) => entry.navigationId === 'divider'), false);
  assert.equal(ledger.businessVerified, 'unknown');
  assert.ok(ledger.caveats.some((caveat) => caveat.includes('does not prove')));
});

test('CLI reads multiple files and leaves compiled artifacts unchanged', async (context) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'feature-census-'));
  context.after(() => rm(tempDir, { recursive: true, force: true }));
  const firstPath = path.join(tempDir, 'first.json');
  const secondPath = path.join(tempDir, 'second.json');
  await writeFile(firstPath, JSON.stringify(salesArtifact));
  await writeFile(secondPath, JSON.stringify(extensionArtifact));
  const before = await Promise.all([readFile(firstPath), readFile(secondPath)]);

  const result = spawnSync(process.execPath, [SCRIPT, firstPath, secondPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const ledger = JSON.parse(result.stdout);
  assert.equal(ledger.inputArtifacts.length, 2);
  assert.equal(ledger.applications.length, 2);
  assert.deepEqual(await Promise.all([readFile(firstPath), readFile(secondPath)]), before);
});

test('requires at least one artifact', () => {
  assert.throws(() => censusArtifacts([]), /at least one compiled ObjectStack artifact/i);
});
