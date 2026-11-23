// 面霸后端：静态文件 + 整份状态读写 + LLM 转发（OpenAI 兼容接口，默认智谱 GLM）。零依赖，Node 18+。
// 只监听 127.0.0.1，由 `tailscale serve` 提供 HTTPS，tailnet 外访问不到。
const http = require('http')
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 8787
const KEY = process.env.LLM_KEY
const LLM_URL = process.env.LLM_URL || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || 'glm-5.3'
const DATA = path.join(__dirname, 'data')
const STATE = path.join(DATA, 'state.json')
const PUBLIC = path.join(__dirname, 'public')
const XUEXI = process.env.XUEXI_DIR || '/opt/xuexi' // xl 课程库镜像目录，不存在时该路径返回 404
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

fs.mkdirSync(DATA, { recursive: true })

// 客户端支持 gzip 且压缩有收益时压缩（手机走 tailnet 中继链路慢，1MB 的岗位列表压缩后只有 ~1/5）
const send = (req, res, code, body, type = 'application/json') => {
  const buf = Buffer.from(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  let payload = buf, extra = {}
  if (buf.length > 1024 && /gzip/.test(req.headers['accept-encoding'] || '')) {
    const gz = zlib.gzipSync(buf)
    if (gz.length < buf.length) { payload = gz; extra = { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' } }
  }
  res.writeHead(code, { 'Content-Type': type, ...extra })
  res.end(payload)
}

const readBody = req => new Promise((ok, fail) => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => { try { ok(JSON.parse(s)) } catch (e) { fail(e) } })
})

// 生成参数由前端按场景传：生成类 max_tokens 4096/8192 + temperature 0.4 + reasoning_effort high，对话类走默认（2048/0.7/low）。
// 2026-11-22 服务器实测（coding 端点 + glm-5.3）：max_tokens 合法范围 [1,131072] 且被严格执行；思考 token 计入 max_tokens 预算；
// reasoning_effort low/high 均被接受且生效（low 时思考≈0）。thinking:{type:'disabled'} 已删：GLM-5.3 系列不支持关思考，字段在标准端点会直接 400。
async function chat({ system, messages, json, max_tokens, temperature, reasoning_effort }) {
  if (!KEY) throw new Error('服务端没配 LLM_KEY / LLM_KEY not configured on server')
  const mt = Number(max_tokens), tp = Number(temperature)
  const effort = ['low', 'medium', 'high', 'max'].includes(reasoning_effort) ? reasoning_effort : ''
  const r = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: Number.isFinite(mt) && mt >= 1 ? Math.min(Math.round(mt), 16384) : 2048, // 端点上限 131072，应用侧 16K 封顶防误传
      temperature: Number.isFinite(tp) ? Math.min(Math.max(tp, 0), 2) : 0.7,
      ...(effort && { reasoning_effort: effort }),
      ...(json && { response_format: { type: 'json_object' } }),
    }),
    // 长 max_tokens 的生成（思考模型 + 8K 输出）远超原 120s，随 token 量放宽、封顶 10 分钟（实测 8192 token 约 80s）
    signal: AbortSignal.timeout(Math.min(600_000, Math.max(120_000, 60_000 + (Number.isFinite(mt) ? mt : 2048) * 60))),
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`)
  const c = (await r.json()).choices[0]
  // finish_reason=length = 被 max_tokens 截断：带 truncated 让前端提示重试/分段，不再静默存半截
  return { content: c.message.content, ...(c.finish_reason === 'length' && { truncated: true }) }
}

// 岗位雷达：只读巡检程序写的 SQLite（JOBS_DB 指向它），没配就不提供
const JOBS_DB = process.env.JOBS_DB
let jobsDb
function jobsConn() {
  if (!JOBS_DB || !fs.existsSync(JOBS_DB)) return null
  if (!jobsDb) {
    const { DatabaseSync } = require('node:sqlite') // Node 22.11 要加 --experimental-sqlite
    jobsDb = new DatabaseSync(JOBS_DB)
    jobsDb.exec('PRAGMA query_only = ON') // 这个版本不认 readOnly 选项，在连接上禁止写入
  }
  return jobsDb
}
// 列表瘦身：只给前端列表/行情渲染用的短字段；jd、score_reason 长文本剔除（手机端每次切前台下整份列表的主犯），
// 有没有 jd 用一位 has_jd 带给前端决定要不要显示「按需拉详情」的折叠入口
const JOBS_LIST = `id, job_name, salary_desc, salary_max_k, brand_name, brand_scale, brand_stage, brand_industry,
  area, business_area, experience, degree, skills, boss_name, boss_title, url, matched, pushed,
  first_seen, seen_count, score, (jd IS NOT NULL AND jd != '') AS has_jd`
function listJobs() {
  const db = jobsConn()
  return db ? db.prepare(`SELECT ${JOBS_LIST} FROM jobs ORDER BY first_seen DESC`).all() : null
}
// 详情通道：/api/jobs?id= 按需取单条全字段（含 jd、score_reason 等），供展开 JD/建目标预填用
function getJob(id) {
  const db = jobsConn()
  return db ? db.prepare(`SELECT id, job_name, salary_desc, salary_max_k, brand_name, brand_scale, brand_stage, brand_industry,
    area, business_area, experience, degree, skills, welfare, boss_name, boss_title, url, query, matched, pushed,
    first_seen, last_seen, seen_count, jd, score, score_reason FROM jobs WHERE id = ?`).get(id) : null
}

http.createServer(async (req, res) => {
  try {
    const pathname = req.url.split('?')[0]
    const params = new URLSearchParams(req.url.split('?')[1] || '')
    if (pathname === '/api/state' && req.method === 'GET') {
      return send(req, res, 200, fs.existsSync(STATE) ? fs.readFileSync(STATE) : '{"resume":"","targets":[]}')
    }
    if (pathname === '/api/state' && req.method === 'PUT') {
      // ponytail: 整份覆盖、后写赢；一个人用够了，多端同时编辑才需要合并
      const state = await readBody(req)
      fs.writeFileSync(STATE + '.tmp', JSON.stringify(state))
      fs.renameSync(STATE + '.tmp', STATE)
      return send(req, res, 200, { ok: true })
    }
    if (pathname === '/api/jobs' && req.method === 'GET') {
      // ?id=<id> 单条全字段（详情通道）；不带参数返回瘦身列表
      const one = params.get('id') ? getJob(params.get('id')) : listJobs()
      if (one === null) return send(req, res, 404, { error: '没配 JOBS_DB / JOBS_DB not configured' })
      return one ? send(req, res, 200, one) : send(req, res, 404, { error: '没有这个岗位 / job not found' })
    }
    if (pathname === '/api/chat' && req.method === 'POST') {
      return send(req, res, 200, await chat(await readBody(req)))
    }
    // xl 课程库镜像：文件名含中文和空格，浏览器会百分号编码，要 decode 后再映射文件
    if (pathname === '/xuexi' || pathname.startsWith('/xuexi/')) {
      let rel = 'index.html'
      try { rel = decodeURIComponent(pathname.replace(/^\/xuexi\/?/, '')) || 'index.html' } catch (e) {}
      const xf = path.join(XUEXI, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
      if (xf.startsWith(XUEXI) && fs.existsSync(xf) && fs.statSync(xf).isFile())
        return send(req, res, 200, fs.readFileSync(xf), TYPES[path.extname(xf)] || 'application/octet-stream')
      return send(req, res, 404, 'not found', 'text/plain')
    }
    const file = path.join(PUBLIC, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
    const target = file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUBLIC, 'index.html')
    send(req, res, 200, fs.readFileSync(target), TYPES[path.extname(target)] || 'application/octet-stream')
  } catch (e) {
    send(req, res, 500, { error: e.message })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mianba on http://127.0.0.1:${PORT}`))
