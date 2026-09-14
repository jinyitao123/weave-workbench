/** Desktop product smoke: Electron owns a real Host and exposes normal product navigation. */
import { _electron as electron } from 'playwright'
import executablePath from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const data = await mkdtemp(join(tmpdir(), 'weave-desktop-product-'))
const entry = fileURLToPath(new URL('../dist', import.meta.url))
const packaged = process.env.WEAVE_DESKTOP_EXECUTABLE
const marker = `--desktop-data=${data}`
const expires = Math.floor(Date.now() / 1000) + 3600
const token = `fixture.${Buffer.from(JSON.stringify({ exp: expires })).toString('base64url')}.signed`
const platform = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/v1/auth/login' && request.method === 'POST') {
    response.end(JSON.stringify({ token, user: { id: 'desktop-user', tenant_id: 'desktop-workspace', username: 'tester', display_name: 'Desktop Tester', role: 'admin' } }))
    return
  }
  if (request.url === '/v1/auth/me') {
    response.end(JSON.stringify({ user: { id: 'desktop-user', tenant_id: 'desktop-workspace', username: 'tester', role: 'admin' } }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ code: 'not_found' }))
})
await new Promise((resolve, reject) => {
  platform.once('error', reject)
  platform.listen(0, '127.0.0.1', resolve)
})
const address = platform.address()
assert(address && typeof address === 'object')
async function markedProcesses() {
  if (process.platform === 'win32') return []
  const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,command='])
  const rows = stdout.split('\n').map(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/u)
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : undefined
  }).filter(Boolean)
  const selected = new Set(rows.filter(row => row.command.includes(marker)).map(row => row.pid))
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true }
  }
  return rows.filter(row => selected.has(row.pid) && row.pid !== process.pid)
}

async function stopMarkedProcesses() {
  const rows = await markedProcesses()
  if (process.platform === 'win32') return
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const row of [...rows].reverse()) { try { process.kill(row.pid, signal) } catch {} }
    await new Promise(resolve => setTimeout(resolve, signal === 'SIGTERM' ? 1000 : 100))
    if ((await markedProcesses()).length === 0) return
  }
  assert.fail(`desktop smoke left processes for ${marker}`)
}

const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/ELECTRON_RUN_AS_NODE|DSH_HOME|WEAVE_API_URL|WEAVE_API_KEY/i.test(key))),
  WEAVE_API_URL: `http://127.0.0.1:${address.port}`,
  WEAVE_API_KEY: 'desktop-smoke-host-key',
}
let application
try {
  application = await electron.launch({ executablePath: packaged || executablePath, args: [...(packaged ? [] : [entry]), '--desktop-smoke', marker], env: environment, timeout: 120_000 })
  const page = await application.firstWindow({ timeout: 120_000 })
  assert.equal(application.windows().length, 1, 'desktop smoke must create exactly one BrowserWindow')
  const readyBy = Date.now() + 60_000
  while (Date.now() < readyBy && !page.url().startsWith('http://127.0.0.1:')) await page.waitForTimeout(100)
  assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/u)
  await page.getByRole('heading', { name: '登录 Workbench' }).waitFor({ timeout: 30_000 })
  await page.getByLabel('账号').fill('tester')
  await page.getByLabel('密码').fill('password')
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByRole('button', { name: '账号：Desktop Tester' }).waitFor({ timeout: 30_000 })

  const project = page.getByRole('button', { name: '选择项目' }).first()
  await project.click()
  assert.equal(await project.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '账号：Desktop Tester' }).click()
  await page.getByRole('dialog', { name: '当前账号' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByText('设置', { exact: true }).last().click()
  await page.getByRole('dialog', { name: '设置' }).waitFor()

  assert.equal(await page.locator('text=预览环境').count(), 0)
  assert.deepEqual(await page.evaluate(() => ({ node: typeof process, require: typeof require })),
    { node: 'undefined', require: 'undefined' })
  const origin = new URL(page.url()).origin
  await application.close()
  application = undefined
  await new Promise(resolve => setTimeout(resolve, 250))
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(2_000) }))
  console.log('PASS desktop owns and stops the real Workbench Host')
  console.log('PASS desktop login carries platform user and workspace identity')
  console.log('PASS project picker, account menu and settings are operable in the desktop window')
  console.log('PASS desktop renderer has no Node capability')
} finally {
  if (application) await application.close().catch(() => {})
  await stopMarkedProcesses()
  assert.equal((await markedProcesses()).length, 0, 'desktop and Host processes must exit after smoke')
  await new Promise(resolve => platform.close(resolve))
  await rm(data, { recursive: true, force: true })
}
