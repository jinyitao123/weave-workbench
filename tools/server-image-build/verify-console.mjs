import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [appArg, contextArg, scriptsArg] = process.argv.slice(2)
if (!appArg || !contextArg) throw new Error('Usage: verify-console.mjs <forge-app> <console-context> [runtime-proof-scripts]')
const app = path.resolve(appArg)
const context = path.resolve(contextArg)
const scripts = scriptsArg ? path.resolve(scriptsArg) : path.join(app, 'scripts')
const lock = JSON.parse(await readFile(path.join(context, 'console94.lock.json'), 'utf8'))
const manifest = JSON.parse(await readFile(path.join(context, 'console94-build.json'), 'utf8'))
const { verifyConsoleArtifact } = await import(pathToFileURL(path.join(scripts, 'console94-artifact.mjs')).href)
let dist = path.join(context, 'dist')
if (scriptsArg) {
  const { resolveForgeConsolePackage } = await import(pathToFileURL(path.join(scripts, 'console94-runtime.mjs')).href)
  const resolved = await resolveForgeConsolePackage(app, lock)
  dist = path.join(resolved.consoleDir, 'dist')
}
const result = await verifyConsoleArtifact({ distDir: dist, manifest, lock })
console.log(JSON.stringify({ consoleVerified: true, ...result }))
