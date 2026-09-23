#!/usr/bin/env node
// Offline inventory of compiled ObjectStack app navigation and metadata.
// The command reads only explicitly supplied JSON artifacts and prints JSON to
// stdout. It never contacts a runtime or edits its inputs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_TYPES = Object.freeze({
  object: { collection: 'objects', targetKeys: ['objectName'] },
  page: { collection: 'pages', targetKeys: ['pageName'] },
  dashboard: { collection: 'dashboards', targetKeys: ['dashboardName'] },
  report: { collection: 'reports', targetKeys: ['reportName'] },
  component: { collection: 'components', targetKeys: ['componentRef', 'componentName'] },
  action: { collection: 'actions', targetKeys: ['actionDef.actionName', 'actionName'] },
});

const PLACEHOLDER_PATTERN = /(?:^|[\s_.-])(?:placeholder|todo|stub|gap|coming[\s_.-]?soon)(?:$|[\s_.-])|占位|待建设|待补齐|待完善|暂缺|未实现|功能缺口/i;
const stringCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectionEntries(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ item, key: String(index) }));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, item]) => ({ item, key }));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  for (const key of ['default', 'zh', 'zh-CN', 'en', 'en-US', 'label']) {
    const candidate = nonEmptyString(value[key]);
    if (candidate) return candidate;
  }
  return '';
}

function getPath(value, dottedPath) {
  let current = value;
  for (const part of dottedPath.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function getPackageScope(bundle, fallback) {
  const manifest = isRecord(bundle?.manifest) ? bundle.manifest : {};
  const namespace = nonEmptyString(manifest.namespace);
  const name = nonEmptyString(manifest.name);
  return nonEmptyString(manifest.id)
    || nonEmptyString(bundle?.packageId)
    || (namespace && name ? namespace + ':' + name : null)
    || namespace
    || name
    || fallback;
}

function definitionName(item, key) {
  const mapKey = /^\d+$/.test(key) ? null : nonEmptyString(key);
  if (item === null || item === undefined) return null;
  if (typeof item === 'string') return item;
  return nonEmptyString(item?.name)
    || nonEmptyString(item?.objectName)
    || nonEmptyString(item?.pageName)
    || mapKey;
}

function bundleValue(value) {
  if (isRecord(value) || Array.isArray(value)) return value;
  if (typeof value === 'string' && /^[\s]*[{[]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function navTargetName(item, targetKeys) {
  for (const key of targetKeys) {
    const name = nonEmptyString(getPath(item, key));
    if (name) return name;
  }
  return null;
}

function visitNavItems(items, groupPath, visitLeaf, itemPath = []) {
  for (const { item, key } of collectionEntries(items)) {
    if (!isRecord(item)) continue;
    const currentPath = [...itemPath, key];
    const type = nonEmptyString(item.type)?.toLowerCase();
    const label = displayText(item.label);
    const children = item.children;

    if (type === 'group') {
      visitNavItems(children, [...groupPath, label || nonEmptyString(item.id) || '（未命名分组）'], visitLeaf, currentPath);
      continue;
    }

    if (type && TARGET_TYPES[type]) {
      visitLeaf(item, type, groupPath, currentPath);
    }

    // Groups are the common parent shape, but walk children on other variants
    // too because the schema allows recursive navigation items.
    if (Array.isArray(children) || isRecord(children)) {
      visitNavItems(children, [...groupPath, label || nonEmptyString(item.id) || '（未命名分组）'], visitLeaf, currentPath);
    }
  }
}

function buildDefinitions(artifactInputs) {
  const definitions = [];
  const applications = [];
  const diagnostics = [];
  const seenBundles = new WeakSet();

  function addDefinitions(bundle, packageScope, source, bundlePath) {
    for (const [kind, spec] of Object.entries(TARGET_TYPES)) {
      for (const { item, key } of collectionEntries(bundle[spec.collection])) {
        const name = definitionName(item, key);
        if (!name) continue;
        definitions.push({
          kind,
          name,
          packageScope,
          sourceArtifact: source.name,
          sourceIndex: source.index,
          bundlePath,
          label: displayText(item?.label),
          ownerObject: null,
        });
      }
    }

    // Object-owned actions also contribute definitions. Retaining the owner
    // helps explain same-name actions that are not globally unique.
    for (const { item: object, key } of collectionEntries(bundle.objects)) {
      if (!isRecord(object)) continue;
      const ownerObject = definitionName(object, key);
      for (const { item, key: actionKey } of collectionEntries(object.actions)) {
        const name = definitionName(item, actionKey);
        if (!name) continue;
        definitions.push({
          kind: 'action',
          name,
          packageScope,
          sourceArtifact: source.name,
          sourceIndex: source.index,
          bundlePath: bundlePath + '.objects.' + ownerObject + '.actions',
          label: displayText(item?.label),
          ownerObject,
        });
      }
    }

    for (const { item: app, key } of collectionEntries(bundle.apps)) {
      if (!isRecord(app)) continue;
      const appName = nonEmptyString(app.name) || nonEmptyString(app.id) || nonEmptyString(key) || '（未命名应用）';
      applications.push({
        name: appName,
        label: displayText(app.label) || appName,
        packageScope: nonEmptyString(app.packageId) || packageScope,
        sourceArtifact: source.name,
        sourceIndex: source.index,
        bundlePath,
        app,
      });
    }
  }

  function walkBundle(value, inheritedScope, source, bundlePath) {
    const bundle = bundleValue(value);
    if (!isRecord(bundle)) {
      diagnostics.push({
        sourceArtifact: source.name,
        sourceIndex: source.index,
        bundlePath,
        kind: 'plugin-bundle-not-inline-object',
      });
      return;
    }
    if (seenBundles.has(bundle)) return;
    seenBundles.add(bundle);

    const packageScope = getPackageScope(bundle, inheritedScope);
    addDefinitions(bundle, packageScope, source, bundlePath);

    for (const { item: plugin, key } of collectionEntries(bundle.plugins)) {
      if (!isRecord(plugin) || plugin.bundle === undefined || plugin.bundle === null) continue;
      const pluginName = nonEmptyString(plugin.name) || nonEmptyString(key) || 'plugin';
      const pluginManifest = isRecord(plugin.manifest) ? plugin.manifest : {};
      const fallbackScope = nonEmptyString(plugin.packageId)
        || nonEmptyString(plugin.package)
        || nonEmptyString(pluginManifest.id)
        || packageScope;
      const nested = bundleValue(plugin.bundle);
      if (nested === null) {
        diagnostics.push({
          sourceArtifact: source.name,
          sourceIndex: source.index,
          bundlePath: bundlePath + '.plugins.' + pluginName + '.bundle',
          kind: 'plugin-bundle-not-inline-object',
        });
        continue;
      }
      if (Array.isArray(nested)) {
        nested.forEach((child, index) =>
          walkBundle(child, fallbackScope, source, bundlePath + '.plugins.' + pluginName + '.bundle.' + index));
      } else {
        walkBundle(nested, fallbackScope, source, bundlePath + '.plugins.' + pluginName + '.bundle');
      }
    }
  }

  for (let index = 0; index < artifactInputs.length; index += 1) {
    const input = artifactInputs[index];
    const source = {
      name: path.basename(input.source || 'artifact-' + (index + 1) + '.json'),
      index,
    };
    if (!isRecord(input.artifact)) {
      throw new TypeError('Artifact ' + source.name + ' must contain a JSON object.');
    }
    const fallbackScope = 'artifact:' + source.name + '#' + (index + 1);
    walkBundle(input.artifact, fallbackScope, source, 'root');
  }

  return { definitions, applications, diagnostics };
}

function buildDirectory(definitions) {
  const byKind = new Map(Object.keys(TARGET_TYPES).map((kind) => [kind, new Map()]));
  for (const definition of definitions) {
    const names = byKind.get(definition.kind);
    if (!names.has(definition.name)) names.set(definition.name, []);
    names.get(definition.name).push(definition);
  }

  const directory = {};
  for (const [kind, names] of byKind) {
    const key = kind === 'object' ? 'objects' : kind === 'page' ? 'pages' : kind + 's';
    directory[key] = [...names.entries()]
      .sort(([left], [right]) => stringCompare(left, right))
      .map(([name, entries]) => {
        const packageCounts = new Map();
        for (const entry of entries) {
          packageCounts.set(entry.packageScope, (packageCounts.get(entry.packageScope) || 0) + 1);
        }
        const packageScopes = [...packageCounts.keys()].sort(stringCompare);
        return {
          name,
          definitionCount: entries.length,
          packageScopes,
          samePackageDuplicateScopes: [...packageCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([scope]) => scope)
            .sort(stringCompare),
          crossPackageNameCollisionCandidate: packageScopes.length > 1,
          definitions: entries.map((entry) => ({
            packageScope: entry.packageScope,
            sourceArtifact: entry.sourceArtifact,
            bundlePath: entry.bundlePath,
            label: entry.label,
            ...(entry.ownerObject ? { ownerObject: entry.ownerObject } : {}),
          })),
        };
      });
  }
  return directory;
}

function buildIndex(definitions) {
  const index = new Map();
  for (const definition of definitions) {
    const key = definition.kind + '\u0000' + definition.name;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(definition);
  }
  return index;
}

function resolveTarget(kind, targetName, packageScope, index) {
  if (!targetName) {
    return {
      registered: false,
      definitionStatus: 'target-not-declared',
      definitionPackageScopes: [],
      samePackageDuplicateDefinitionCandidate: false,
      crossPackageNameCollisionCandidate: false,
    };
  }

  const matches = index.get(kind + '\u0000' + targetName) || [];
  if (matches.length === 0) {
    if (kind === 'component') {
      return {
        registered: null,
        definitionStatus: 'runtime-registry-not-contained-in-artifact',
        definitionPackageScopes: [],
        samePackageDuplicateDefinitionCandidate: false,
        crossPackageNameCollisionCandidate: false,
      };
    }
    return {
      registered: false,
      definitionStatus: 'missing-definition',
      definitionPackageScopes: [],
      samePackageDuplicateDefinitionCandidate: false,
      crossPackageNameCollisionCandidate: false,
    };
  }

  const localMatches = matches.filter((definition) => definition.packageScope === packageScope);
  const packageScopes = [...new Set(matches.map((definition) => definition.packageScope))].sort(stringCompare);
  const samePackageDuplicateDefinitionCandidate = localMatches.length > 1;
  const crossPackageNameCollisionCandidate = packageScopes.length > 1;

  let definitionStatus;
  if (samePackageDuplicateDefinitionCandidate) {
    definitionStatus = 'duplicate-in-package-candidate';
  } else if (localMatches.length === 1) {
    definitionStatus = 'registered-in-package';
  } else if (matches.length === 1) {
    definitionStatus = 'registered-in-other-package';
  } else if (packageScopes.length === 1) {
    definitionStatus = 'duplicate-in-other-package-candidate';
  } else {
    definitionStatus = 'ambiguous-across-packages-candidate';
  }

  return {
    registered: true,
    definitionStatus,
    definitionPackageScopes: packageScopes,
    samePackageDuplicateDefinitionCandidate,
    crossPackageNameCollisionCandidate,
  };
}

function isPlaceholderCandidate(navItem, targetName, matchingDefinitions) {
  const text = [
    targetName,
    displayText(navItem.label),
    ...matchingDefinitions.map((definition) => definition.label),
  ].filter(Boolean).join(' ');
  return PLACEHOLDER_PATTERN.test(text);
}

export function censusArtifacts(artifactInputs) {
  if (!Array.isArray(artifactInputs) || artifactInputs.length === 0) {
    throw new TypeError('Provide at least one compiled ObjectStack artifact.');
  }

  const { definitions, applications, diagnostics } = buildDefinitions(artifactInputs);
  const directory = buildDirectory(definitions);
  const index = buildIndex(definitions);
  const entries = [];

  for (const appRecord of applications) {
    const { app, packageScope, sourceArtifact, sourceIndex } = appRecord;
    const roots = [];

    for (const { item: area, key } of collectionEntries(app.areas)) {
      if (!isRecord(area)) continue;
      const areaLabel = displayText(area.label) || nonEmptyString(area.id) || key;
      roots.push({
        items: area.navigation,
        groupPath: [areaLabel],
        area: { id: nonEmptyString(area.id), label: areaLabel },
      });
    }
    if (app.navigation !== undefined) {
      roots.push({ items: app.navigation, groupPath: [], area: null });
    }

    for (const root of roots) {
      visitNavItems(root.items, root.groupPath, (navItem, kind, groupPath, itemPath) => {
        const targetName = navTargetName(navItem, TARGET_TYPES[kind].targetKeys);
        const matchingDefinitions = targetName ? (index.get(kind + '\u0000' + targetName) || []) : [];
        const resolution = resolveTarget(kind, targetName, packageScope, index);
        const placeholderCandidate = isPlaceholderCandidate(navItem, targetName, matchingDefinitions);
        entries.push({
          sourceArtifact,
          sourceIndex,
          packageScope,
          application: appRecord.name,
          applicationLabel: appRecord.label,
          area: root.area,
          navigationGroup: groupPath,
          navigationGroupLabel: groupPath.join(' / '),
          navigationId: nonEmptyString(navItem.id),
          navigationLabel: displayText(navItem.label),
          navigationPath: itemPath,
          navigationType: kind,
          target: targetName ? kind + ':' + targetName : null,
          targetKind: kind,
          targetName,
          registered: resolution.registered,
          definitionStatus: resolution.definitionStatus,
          definitionPackageScopes: resolution.definitionPackageScopes,
          samePackageDuplicateDefinitionCandidate: resolution.samePackageDuplicateDefinitionCandidate,
          crossPackageNameCollisionCandidate: resolution.crossPackageNameCollisionCandidate,
          placeholderCandidate,
          placeholderCandidateBasis: placeholderCandidate ? 'name-or-label-heuristic' : null,
          samePackageTargetOccurrenceCount: 0,
          samePackageDuplicateTargetCandidate: false,
          businessVerified: 'unknown',
        });
      });
    }
  }

  const packageTargetCounts = new Map();
  const applicationTargetCounts = new Map();
  for (const entry of entries) {
    if (!entry.targetName) continue;
    const packageKey = [entry.packageScope, entry.targetKind, entry.targetName].join('\u0000');
    const applicationKey = [entry.packageScope, entry.application, entry.targetKind, entry.targetName].join('\u0000');
    packageTargetCounts.set(packageKey, (packageTargetCounts.get(packageKey) || 0) + 1);
    applicationTargetCounts.set(applicationKey, (applicationTargetCounts.get(applicationKey) || 0) + 1);
  }
  for (const entry of entries) {
    if (!entry.targetName) continue;
    const packageKey = [entry.packageScope, entry.targetKind, entry.targetName].join('\u0000');
    const applicationKey = [entry.packageScope, entry.application, entry.targetKind, entry.targetName].join('\u0000');
    entry.samePackageTargetOccurrenceCount = packageTargetCounts.get(packageKey);
    entry.samePackageDuplicateTargetCandidate = entry.samePackageTargetOccurrenceCount > 1;
    entry.sameApplicationTargetOccurrenceCount = applicationTargetCounts.get(applicationKey);
    entry.sameApplicationDuplicateTargetCandidate = entry.sameApplicationTargetOccurrenceCount > 1;
  }

  entries.sort((left, right) =>
    left.sourceIndex - right.sourceIndex
    || stringCompare(left.packageScope, right.packageScope)
    || stringCompare(left.application, right.application)
    || stringCompare(left.navigationGroupLabel || '', right.navigationGroupLabel || '')
    || stringCompare(left.navigationId || '', right.navigationId || '')
    || stringCompare(left.target || '', right.target || ''),
  );

  const appSummaries = applications.map((appRecord) => {
    const appEntries = entries.filter((entry) =>
      entry.sourceIndex === appRecord.sourceIndex
      && entry.packageScope === appRecord.packageScope
      && entry.application === appRecord.name);
    return {
      sourceArtifact: appRecord.sourceArtifact,
      sourceIndex: appRecord.sourceIndex,
      packageScope: appRecord.packageScope,
      application: appRecord.name,
      applicationLabel: appRecord.label,
      navigationEntryCount: appEntries.length,
      businessVerified: 'unknown',
    };
  });

  const inputArtifactSummaries = artifactInputs.map((input, index) => {
    const source = path.basename(input.source || 'artifact-' + (index + 1) + '.json');
    return {
      sourceIndex: index,
      sourceArtifact: source,
      packageScope: getPackageScope(input.artifact, 'artifact:' + source + '#' + (index + 1)),
    };
  });

  return {
    schemaVersion: 1,
    inputArtifacts: inputArtifactSummaries,
    businessVerified: 'unknown',
    caveats: [
      'This is an offline inventory of compiled metadata only.',
      'A navigation entry or registered definition does not prove that users can complete the business task.',
      'Repeat-target, duplicate-definition, cross-package-name, and placeholder flags are review candidates, not pass/fail results.',
      'businessVerified is always unknown; verify behavior through the normal user path and independent readback.',
    ],
    applications: appSummaries,
    directory,
    entries,
    diagnostics,
  };
}

export function usage() {
  return [
    'Usage: node scripts/feature-census.mjs <artifact.json> [artifact.json ...]',
    '',
    'Read compiled ObjectStack JSON artifacts, including inline plugins[].bundle objects.',
    'Print a JSON inventory to stdout. No network access or input-file writes are performed.',
  ].join('\n');
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }
  if (args.length === 0) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const artifactInputs = [];
  for (let index = 0; index < args.length; index += 1) {
    const source = args[index];
    try {
      const contents = await readFile(source, 'utf8');
      artifactInputs.push({ source, index, artifact: JSON.parse(contents) });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error('Cannot read compiled artifact ' + path.basename(source) + ': ' + cause);
      process.exitCode = 1;
      return;
    }
  }

  try {
    console.log(JSON.stringify(censusArtifacts(artifactInputs), null, 2));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    console.error('Cannot build feature census: ' + cause);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  await main(process.argv.slice(2));
}
