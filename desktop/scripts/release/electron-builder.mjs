#!/usr/bin/env node
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Select electron-builder's bundled filesystem collector in this process.
 * The npm collector can omit duplicate transitive references with npm 12 and
 * shared node_modules. We do not edit the installed library or dependencies.
 * This explicit adapter fails closed if the pinned builder API changes.
 */
export function selectTraversalCollector(factory) {
  if (typeof factory?.getCollectorByPackageManager !== 'function' || factory.PM?.TRAVERSAL !== 'traversal') {
    throw new Error('electron-builder traversal collector API is unavailable; packaging cannot safely collect runtime dependencies')
  }
  const original = factory.getCollectorByPackageManager
  factory.getCollectorByPackageManager = (_manager, root, temporary) => original(factory.PM.TRAVERSAL, root, temporary)
}

if (!process.argv[1] || import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const require = createRequire(import.meta.url)
  selectTraversalCollector(require('app-builder-lib/out/node-module-collector/index.js'))
  console.log("Packaging uses electron-builder's built-in traversal collector; installed dependencies remain unchanged.")
  await import(pathToFileURL(require.resolve('electron-builder/cli.js')).href)
}
