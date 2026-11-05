// 面霸后端：静态文件 + 整份状态读写 + LLM 转发（OpenAI 兼容接口，默认智谱 GLM）。零依赖，Node 18+。
// 只监听 127.0.0.1，由 `tailscale serve` 提供 HTTPS，tailnet 外访问不到。
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 8787
const KEY = process.env.LLM_KEY
const LLM_URL = process.env.LLM_URL || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || 'glm-5.3'
const DATA = path.join(__dirname, 'data')
const STATE = path.join(DATA, 'state.json')
const PUBLIC = path.join(__dirname, 'public')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }

fs.mkdirSync(DATA, { recursive: true })

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const readBody = req => new Promise((ok, fail) => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => { try { ok(JSON.parse(s)) } catch (e) { fail(e) } })
})

async function chat({ system, messages, json }) {
  if (!KEY) throw new Error('服务端没配 LLM_KEY')
  const r = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.7,
      thinking: { type: 'disabled' }, // 智谱扩展参数：关掉思考，面试对话要快
      ...(json && { response_format: { type: 'json_object' } }),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`)
  return (await r.json()).choices[0].message.content
}

// 岗位雷达：只读巡检程序写的 SQLite（JOBS_DB 指向它），没配就不提供
const JOBS_DB = process.env.JOBS_DB
let jobsDb
function listJobs() {
  if (!JOBS_DB || !fs.existsSync(JOBS_DB)) return null
  if (!jobsDb) {
    const { DatabaseSync } = require('node:sqlite') // Node 22.11 要加 --experimental-sqlite
    jobsDb = new DatabaseSync(JOBS_DB)
    jobsDb.exec('PRAGMA query_only = ON') // 这个版本不认 readOnly 选项，在连接上禁止写入
  }
  return jobsDb.prepare(`SELECT id, job_name, salary_desc, salary_max_k, brand_name, brand_scale, brand_stage, brand_industry,
    area, business_area, experience, degree, skills, welfare, boss_name, boss_title, url, query, matched, pushed,
    first_seen, last_seen, seen_count, jd, score, score_reason FROM jobs ORDER BY first_seen DESC`).all()
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/state' && req.method === 'GET') {
      return send(res, 200, fs.existsSync(STATE) ? fs.readFileSync(STATE) : '{"resume":"","targets":[]}')
    }
    if (req.url === '/api/state' && req.method === 'PUT') {
      // ponytail: 整份覆盖、后写赢；一个人用够了，多端同时编辑才需要合并
      const state = await readBody(req)
      fs.writeFileSync(STATE + '.tmp', JSON.stringify(state))
      fs.renameSync(STATE + '.tmp', STATE)
      return send(res, 200, { ok: true })
    }
    if (req.url === '/api/jobs' && req.method === 'GET') {
      const jobs = listJobs()
      return jobs ? send(res, 200, jobs) : send(res, 404, { error: '没配 JOBS_DB' })
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      return send(res, 200, { content: await chat(await readBody(req)) })
    }
    const file = path.join(PUBLIC, path.normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, ''))
    const target = file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUBLIC, 'index.html')
    send(res, 200, fs.readFileSync(target), TYPES[path.extname(target)] || 'application/octet-stream')
  } catch (e) {
    send(res, 500, { error: e.message })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mianba on http://127.0.0.1:${PORT}`))
