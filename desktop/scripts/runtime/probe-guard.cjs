// Instrumentation for the offline release probe, never a product sandbox.
// It rejects shared CLI credential paths before the fs call and network/child
// process attempts, including attempts swallowed by the CLI's error handling.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { fileURLToPath } = require('node:url')
const { syncBuiltinESMExports } = require('node:module')
const log = process.env.WEAVE_RUNTIME_PROBE_LOG
const append = fs.appendFileSync.bind(fs)
const home = os.homedir()
const protectedRoots = ['.pi', '.prime', '.codex', '.claude', '.config/opencode', '.npmrc', '.netrc', '.aws', '.azure', '.config/gcloud', 'Library/Keychains']
  .map(relative => path.resolve(home, relative))
/** @returns {never} */
function violation(kind) {
  if (log) append(log, `${process.env.WEAVE_RUNTIME_PROBE_LABEL ?? 'control'}:${kind}\n`, { mode: 0o600 })
  const error = new Error('Offline runtime probe attempted a forbidden operation')
  Object.assign(error, { code: 'WEAVE_RUNTIME_PROBE_FORBIDDEN' })
  throw error
}
function check(value) {
  if (value instanceof URL) value = fileURLToPath(value)
  if (Buffer.isBuffer(value)) value = value.toString()
  if (typeof value !== 'string') return
  const candidate = path.resolve(value)
  const forbidden = protectedRoots.find(root => candidate === root || candidate.startsWith(`${root}${path.sep}`))
  if (forbidden) violation(`shared-config(${path.relative(home, forbidden)})`)
}
for (const name of ['access', 'appendFile', 'chmod', 'chown', 'createReadStream', 'createWriteStream', 'exists', 'lchmod', 'lchown', 'link', 'lstat', 'lutimes', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readFile', 'readdir', 'readlink', 'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'truncate', 'unlink', 'utimes', 'watch', 'watchFile', 'writeFile', 'copyFile', 'cp', 'symlink']) {
  for (const key of [name, `${name}Sync`]) {
    if (typeof fs[key] !== 'function') continue
    const original = fs[key]
    fs[key] = function (...args) {
      check(args[0])
      if (['copyFile', 'cp', 'link', 'rename', 'symlink'].includes(name)) check(args[1])
      return original.apply(this, args)
    }
  }
  if (typeof fs.promises[name] === 'function') {
    const original = fs.promises[name]
    fs.promises[name] = async function (...args) {
      check(args[0])
      if (['copyFile', 'cp', 'link', 'rename', 'symlink'].includes(name)) check(args[1])
      return original.apply(this, args)
    }
  }
}
/** @type {[string, string[]][]} */
const blockedModules = [
  ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
  ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
  ['node:child_process', ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
]
for (const [moduleName, names] of blockedModules) {
  const module = require(moduleName)
  for (const name of names) module[name] = (...args) => violation(moduleName === 'node:child_process' ? `subprocess(${path.basename(String(args[0])).slice(0,40)})` : 'network')
}
require('node:net').Socket.prototype.connect = () => violation('network')
globalThis.fetch = () => violation('network')
syncBuiltinESMExports()
