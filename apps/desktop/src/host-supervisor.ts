/** Supervise the real local Workbench Host used by the desktop product. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { workbenchEnvironment, validateWeaveCommand } from '../../../scripts/workbench.js'

const READY_PREFIX = 'dsh web: '
const MAX_DIAGNOSTIC_BYTES = 24 * 1024

/** Running product Host and its one-time authenticated bootstrap URL. */
export interface ProductHost {
  readonly url: string
  readonly process: ChildProcess
  close(): Promise<void>
}

/** Extract the canonical loopback bootstrap URL without accepting LAN or arbitrary output. */
export function productHostUrl(line: string): string | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).split(' ')[0]?.trim()
  if (candidate === undefined || candidate === '') return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.pathname !== '/' || !url.searchParams.has('token')) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function appendDiagnostic(current: string, chunk: string): string {
  const combined = current + chunk
  return combined.length <= MAX_DIAGNOSTIC_BYTES ? combined : combined.slice(-MAX_DIAGNOSTIC_BYTES)
}

function waitForExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => { cleanup(); resolve(false) }, milliseconds)
    const done = () => { cleanup(); resolve(true) }
    const cleanup = () => { clearTimeout(timer); child.off('exit', done) }
    child.once('exit', done)
  })
}

/**
 * Start the maintained Workbench profile inside Electron's bundled Node runtime.
 * The Host owns sessions, platform login, user/workspace binding, tools and model settings;
 * the desktop process only supervises it and consumes its authenticated local URL.
 */
export async function startProductHost(options: {
  readonly electronExecutable: string
  readonly runtimeRoot: string
  readonly sourceMode: boolean
  readonly dataDirectory: string
  readonly environment: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}): Promise<ProductHost> {
  await mkdir(options.dataDirectory, { recursive: true })
  const root = resolve(options.runtimeRoot)
  const entry = options.sourceMode ? join(root, 'apps/cli/src/bin.ts') : join(root, 'lib/bin.js')
  const inherited = validateWeaveCommand(workbenchEnvironment(options.environment), root)
  const environment: NodeJS.ProcessEnv = {
    ...inherited,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: options.dataDirectory,
  }
  const child = spawn(options.electronExecutable, [
    '--expose-internals', ...(options.sourceMode ? ['--import', 'tsx/esm'] : []), entry,
    '--profile', 'workbench', '--no-open', '--host', '127.0.0.1', '--port', '0',
  ], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })

  let diagnostic = ''
  const timeoutMs = options.timeoutMs ?? 45_000
  const url = await new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    let output = ''
    let timer: NodeJS.Timeout
    const finish = (error?: Error, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      if (error) rejectReady(error)
      else resolveReady(value!)
    }
    const inspect = (chunk: Buffer | string) => {
      output += String(chunk)
      const lines = output.split(/\r?\n/u)
      output = lines.pop() ?? ''
      for (const line of lines) {
        const found = productHostUrl(line)
        if (found !== undefined) { finish(undefined, found); return }
      }
    }
    const onError = (error: Error) => finish(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(
      `Workbench Host stopped before startup (${signal ?? String(code)}).${diagnostic.trim() === '' ? '' : ` ${diagnostic.trim()}`}`,
    ))
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', (chunk: Buffer | string) => { diagnostic = appendDiagnostic(diagnostic, String(chunk)) })
    child.once('error', onError)
    child.once('exit', onExit)
    timer = setTimeout(() => finish(new Error(
      `Workbench Host did not become ready within ${String(timeoutMs)} ms.${diagnostic.trim() === '' ? '' : ` ${diagnostic.trim()}`}`,
    )), timeoutMs)
  }).catch(async error => {
    child.kill('SIGTERM')
    if (!await waitForExit(child, 5_000)) child.kill('SIGKILL')
    throw error
  })

  return {
    url,
    process: child,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      if (!await waitForExit(child, 10_000)) {
        child.kill('SIGKILL')
        await waitForExit(child, 5_000)
      }
    },
  }
}
