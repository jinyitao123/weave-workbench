#!/usr/bin/env node
// 品牌素材生成：GPT Image 出图（Logo、视频关键帧），火山方舟 Seedance 首尾帧生成循环视频。
// 用法与提示词见 docs/architecture/品牌视觉与登录页设计.md。密钥只从环境变量读取，不写入文件或输出。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const ARK_BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

const usage = `用法:
  node tools/brand-media.mjs image --prompt-file <文本> [--ref <图片> ...] [--size 1024x1024] [--quality high]
                                   [--background transparent|opaque|auto] [--format png|webp|jpeg] [--n 4]
                                   --model <已核模型ID> [--out .brand-media/images]
  node tools/brand-media.mjs video --prompt-file <文本> --first <图片> [--last <图片>] --model <方舟模型ID>
                                   [--duration 10] [--resolution 1080p] [--seed 42] [--out .brand-media/videos]
环境变量: OPENAI_API_KEY（image）、ARK_API_KEY（video）；可选 OPENAI_IMAGE_MODEL、ARK_VIDEO_MODEL、OPENAI_BASE_URL、ARK_BASE_URL。`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'prompt-file': { type: 'string' }, prompt: { type: 'string' },
    ref: { type: 'string', multiple: true }, size: { type: 'string', default: '1024x1024' },
    quality: { type: 'string', default: 'high' }, background: { type: 'string', default: 'auto' },
    format: { type: 'string', default: 'png' }, n: { type: 'string', default: '4' },
    model: { type: 'string' }, out: { type: 'string' },
    first: { type: 'string' }, last: { type: 'string' },
    duration: { type: 'string', default: '10' }, resolution: { type: 'string', default: '1080p' },
    seed: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
})

function fail(message) {
  console.error(message)
  process.exit(1)
}

function requireKey(name) {
  const key = process.env[name]
  if (!key) fail(`缺少环境变量 ${name}。`)
  return key
}

async function readPrompt() {
  const text = values.prompt ?? (values['prompt-file'] ? await readFile(values['prompt-file'], 'utf8') : '')
  if (!text.trim()) fail('需要 --prompt 或 --prompt-file。')
  return text.trim()
}

async function dataUri(path) {
  const type = MIME[extname(path).toLowerCase()]
  if (!type) fail('不支持的图片格式。')
  return `data:${type};base64,${(await readFile(path)).toString('base64')}`
}

async function request(url, init, label) {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) fail(`${label} 失败: HTTP ${response.status} `)
  try { return JSON.parse(text) } catch { fail(`${label} 返回格式无效。`) }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
}

async function image() {
  const key = requireKey('OPENAI_API_KEY')
  const prompt = await readPrompt()
  const model = values.model || process.env.OPENAI_IMAGE_MODEL
  if (!model) fail('需要显式 --model 或 OPENAI_IMAGE_MODEL；本研究工具未验证供应商当前模型。')
  const out = resolve(values.out || '.brand-media/images')
  const common = { model, prompt, size: values.size, quality: values.quality, background: values.background,
    output_format: values.format, n: Number(values.n) }
  let result
  if (values.ref?.length) {
    // 有参考图时走 edits：用已选定的 Logo 约束同一品牌家族
    const form = new FormData()
    for (const [name, value] of Object.entries(common)) form.append(name, String(value))
    for (const path of values.ref) {
      const type = MIME[extname(path).toLowerCase()] || fail('不支持的图片格式。')
      form.append('image[]', new Blob([await readFile(path)], { type }), basename(path))
    }
    result = await request(`${OPENAI_BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, '图片编辑')
  } else {
    result = await request(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(common),
    }, '图片生成')
  }
  await mkdir(out, { recursive: true })
  const prefix = stamp()
  const files = []
  for (const [index, item] of (result.data || []).entries()) {
    if (!item.b64_json) continue
    const file = join(out, `${prefix}-${index + 1}.${values.format === 'jpeg' ? 'jpg' : values.format}`)
    await writeFile(file, Buffer.from(item.b64_json, 'base64'))
    files.push(file)
  }
  await writeFile(join(out, `${prefix}.prompt.txt`), `${model} ${values.size} ${values.quality} ${values.background}\n\n${prompt}\n`)
  if (!files.length) fail('接口未返回图片。')
  console.log(files.join('\n'))
}

async function video() {
  const key = requireKey('ARK_API_KEY')
  const prompt = await readPrompt()
  const model = values.model || process.env.ARK_VIDEO_MODEL
  if (!model) fail('需要 --model 或 ARK_VIDEO_MODEL：从方舟控制台模型广场复制支持首尾帧的 Seedance 模型 ID。')
  if (!values.first) fail('需要 --first 首帧图片。循环视频的尾帧默认与首帧相同。')
  const out = resolve(values.out || '.brand-media/videos')
  const first = await dataUri(values.first)
  const last = values.last ? await dataUri(values.last) : first
  const body = {
    model,
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: first }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: last }, role: 'last_frame' },
    ],
    ratio: 'adaptive',
    resolution: values.resolution,
    duration: Number(values.duration),
    watermark: false,
    ...(values.seed ? { seed: Number(values.seed) } : {}),
  }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const task = await request(`${ARK_BASE}/contents/generations/tasks`, { method: 'POST', headers, body: JSON.stringify(body) }, '提交视频任务')
  console.log(`任务已提交，等待生成…`)
  const deadline = Date.now() + 30 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 10_000))
    const state = await request(`${ARK_BASE}/contents/generations/tasks/${task.id}`, { headers }, '查询视频任务')
    if (state.status === 'succeeded') {
      const url = state.content?.video_url
      if (!url) fail('任务成功但未返回视频地址。')
      const response = await fetch(url)
      if (!response.ok) fail(`下载视频失败: HTTP ${response.status}`)
      await mkdir(out, { recursive: true })
      const prefix = stamp()
      const file = join(out, `${prefix}.mp4`)
      await writeFile(file, Buffer.from(await response.arrayBuffer()))
      await writeFile(join(out, `${prefix}.prompt.txt`), `${model} ${values.resolution} ${values.duration}s seed=${values.seed ?? '随机'}\n\n${prompt}\n`)
      console.log(file)
      return
    }
    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'canceled') {
      fail(`视频任务未完成: ${state.status} `)
    }
    process.stdout.write('.')
  }
  fail('等待超过 30 分钟，请到方舟控制台查看任务。')
}

try {
if (values.help || !positionals[0]) {
  console.log(usage)
} else if (positionals[0] === 'image') {
  await image()
} else if (positionals[0] === 'video') {
  await video()
} else {
  fail(usage)
}

} catch { fail('素材研究操作失败；未输出供应商响应、凭据或本机路径。') }
