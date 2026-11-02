// 面霸前端：原生 JS，hash 路由，整份状态存服务端。
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const txt = v => Array.isArray(v) ? v.join('\n') : v // AI 偶尔把字符串字段返回成数组

let S = { resume: '', targets: [] }
let busy = false
let J = null // 岗位雷达：null 加载中，false 服务器没接巡检数据
const jf = { all: false, sort: 'new', q: '' }

async function api(url, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}
const load = async () => { S = await api('/api/state') }
const save = () => api('/api/state', S, 'PUT')
const loadJobs = () => api('/api/jobs').then(j => { J = j }, () => { J = false })
const chat = async (system, messages) => (await api('/api/chat', { system, messages })).content
async function askJSON(system, user) {
  const { content } = await api('/api/chat', { system, messages: [{ role: 'user', content: user }], json: true })
  try { return JSON.parse(content.replace(/```json|```/g, '').trim()) } catch { throw new Error('AI 返回格式不对，再试一次') }
}
const target = id => S.targets.find(t => t.id === id)
const title = t => `${t.company} · ${t.role}`

async function withBusy(fn) {
  if (busy) return
  busy = true
  document.body.classList.add('busy')
  try { await fn() } catch (e) { alert(e.message) } finally { busy = false; document.body.classList.remove('busy') }
}

// ---------- Prompts ----------
const P = {
  material: t => `<候选人简历>\n${S.resume}\n</候选人简历>\n\n<岗位JD>\n${t.jd}\n</岗位JD>`,
  gaps: `你是资深技术面试官。对照 JD 和候选人简历，拆出 JD 的 5-10 条核心要求，逐条判断简历能否证明。
输出严格 JSON：{"gaps":[{"requirement":"JD 要求","evidence":"简历中能证明它的具体经历，没有就空字符串","strength":"strong|weak|none","probe":"面试官针对这一条最可能的追问，一句话"}]}
只依据简历原文判断，不要替候选人脑补经历。`,
  tailor: `你是简历顾问。用户会给出<候选人简历>和<岗位JD>，请按 JD 改写这份简历：可以调整顺序、改措辞、突出和 JD 相关的经历、删掉无关内容。
绝对不能新增简历里没有的事实、数字、技术栈或经历。
输出纯文本：先给改写后的完整简历，再用「## 改动说明」逐条列出改了什么、为什么。`,
  intel: t => `下面是网上关于「${title(t)}」的面经原文，可能有多篇。提炼要点：面试轮次和流程、高频题目、面试官风格、踩坑提醒。
中文条目式，不超过 300 字。只写原文里有的内容。`,
  interviewer: t => `你是${t.company}的${t.role}岗位面试官，正在进行技术面试。中文口语化，每次只问一个问题，1-3 句话。
重点针对简历中证明力弱或缺失的点深挖，同一个点追问 2-3 层（为什么这么做、数据量级、遇到的问题、重来会怎么做），候选人答透了就换下一个点。不要给答案，不要点评，不要出戏。

${P.material(t)}

## 重点追问清单
${t.gaps.filter(g => g.strength !== 'strong').map(g => `- ${g.requirement}：${g.probe}`).join('\n')}

## 面经情报
${t.intel || '无'}`,
  review: `你是面试复盘教练。下面是一场模拟面试记录。输出严格 JSON，格式为 {"verdict":"...","weak":"...","better":"..."}，
三个字段都是字符串，多条内容在字符串内用换行分隔，不要用数组：
verdict：如果是真实面试能否通过、为什么（2-3 句）；
weak：回答最薄弱的 2-4 处，指出问题所在；
better：针对这几处给出更好的回答思路或示例。`,
  greeting: '你好，我是今天的面试官。先做个简单的自我介绍吧，重点讲讲和这个岗位相关的经历。',
}

// ---------- 页面 ----------
const back = href => `<a href="${href}">‹ 返回</a>`
const icon = g => ({ strong: '✅', weak: '⚠️' })[g.strength] || '❌'
const reviewHTML = r => [['🎯 能否通过', r.verdict], ['⚠️ 薄弱回答', r.weak], ['✨ 更好的答法', r.better]]
  .map(([h, v]) => `<div class=card><b>${h}</b><pre>${esc(txt(v) || '（AI 没给出这一项）')}</pre></div>`).join('')

// 巡检时间是北京时间字符串 "2026-11-02 10:31:41"
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
const when = s => s ? (s.startsWith(today()) ? '今天 ' : s.slice(5, 11)) + s.slice(11, 16) : ''
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '#'
const join = (a, sep = ' · ') => a.filter(Boolean).join(sep)
const jobTarget = j => S.targets.find(t => t.jobId === j.id)

const radar = () => {
  if (!J) return ''
  const m = J.filter(j => j.matched)
  const fresh = m.filter(j => j.first_seen?.startsWith(today())).length
  const last = J.reduce((a, j) => j.last_seen > a ? j.last_seen : a, '')
  return `<h2>岗位雷达 <small>共 ${J.length} 个，最近巡检 ${when(last)}</small></h2>
<a class=row href="#/jobs">符合条件 ${m.length} 个${fresh ? ` · <b class=new>今天新增 ${fresh}</b>` : ''}<small>看薪资、公司、技能标签，一键建为目标岗位</small></a>`
}

const home = () => `<h1>面霸</h1>
${radar()}
<h2>我的简历</h2>
<a class=row href="#/resume">${S.resume ? `已录入 ${S.resume.length} 字` : '还没有简历，点这里添加'}</a>
<h2>目标岗位</h2>
${S.targets.map(t => `<a class=row href="#/t/${t.id}">${esc(title(t))}<small>模拟面试 ${t.sessions.length} 次</small></a>`).join('')}
${S.resume ? '<a class="btn primary" href="#/new">＋ 新建目标岗位</a>' : ''}`

const resumePage = () => `${back('#/')}<h1>我的简历</h1>
<label class=btn>导入 PDF<input type=file accept=application/pdf hidden onchange="importPDF(this.files[0])"></label>
<textarea id=resume rows=20 placeholder="粘贴简历文字，或导入 PDF">${esc(S.resume)}</textarea>
<button class=primary onclick="saveResume()">保存</button>`

const jdDraft = j => `${join([j.job_name, j.salary_desc, join([j.area, j.business_area], ''), j.experience, j.degree], '｜')}
技能标签：${j.skills || '无'}

${j.jd || '（职位描述还没抓到：打开 BOSS 岗位详情，把完整职位描述粘贴到这里替换这一行，分析会准得多）'}`

const newPage = j => `${back(j ? '#/jobs' : '#/')}<h1>新建目标岗位</h1>
<input id=company placeholder="公司" value="${esc(j?.brand_name)}"><input id=role placeholder="岗位" value="${esc(j?.job_name)}">
${j && !j.jd ? `<a class=btn href="${esc(safeUrl(j.url))}" target=_blank rel=noopener>去 BOSS 复制完整 JD ›</a>` : ''}
<textarea id=jd rows=14 placeholder="整段粘贴 JD">${j ? esc(jdDraft(j)) : ''}</textarea>
<button class=primary onclick="analyze()">分析差距</button>`

const jobsPage = () => `${back('#/')}<h1>岗位雷达</h1>
${J === null ? '<small>加载中…</small>' : J === false ? '<small>服务器没接巡检数据（JOBS_DB）</small>' : `
<input id=jq type=search placeholder="搜公司 / 职位 / 技能 / 区域 / 职位描述" value="${esc(jf.q)}" oninput="jf.q = this.value; renderJobs()">
<button class="${jf.all ? '' : 'primary'}" onclick="jf.all = !jf.all; renderJobs(this)">只看符合条件</button>
<button onclick="jf.sort = jf.sort === 'new' ? 'pay' : 'new'; renderJobs(this)">${jf.sort === 'new' ? '按发现时间' : '按薪资上限'}</button>
<div id=jobs></div>`}`

const jobCard = j => {
  const t = jobTarget(j)
  return `<div class=card>
<span class=pay>${esc(j.salary_desc)}</span><b>${j.first_seen?.startsWith(today()) ? '<span class=new>新</span> ' : ''}${esc(j.job_name)}</b>
<small>${esc(join([j.brand_name, j.brand_scale, j.brand_stage, j.brand_industry]))}</small>
<small>${esc(join([join([j.area, j.business_area], ''), j.experience, j.degree, j.boss_name && join([j.boss_name, j.boss_title], ' ')]))}</small>
${j.skills ? `<div class=tags>${j.skills.split(',').slice(0, 10).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
${j.jd ? `<details><summary>职位描述</summary><pre>${esc(j.jd)}</pre></details>` : ''}
<small>首次发现 ${when(j.first_seen)} · 出现 ${j.seen_count} 次${j.pushed ? ' · 已推送' : ''}${j.matched ? '' : ' · 不符合条件'}</small>
<a class=btn href="${esc(safeUrl(j.url))}" target=_blank rel=noopener>去 BOSS 看</a>
${t ? `<a class=btn href="#/t/${t.id}">已建目标 ›</a>` : `<a class="btn primary" href="#/new/${encodeURIComponent(j.id)}">建为目标岗位</a>`}
</div>`
}

// 只重画列表，搜索框不丢焦点；传入按钮时顺便重画按钮状态
function renderJobs(btn) {
  if (btn) return route()
  if (!$('#jobs') || !J) return
  const q = jf.q.trim().toLowerCase()
  const list = J.filter(j => (jf.all || j.matched) &&
    (!q || join([j.job_name, j.brand_name, j.skills, j.area, j.business_area, j.brand_industry, j.jd], ' ').toLowerCase().includes(q)))
  if (jf.sort === 'pay') list.sort((a, b) => (b.salary_max_k ?? -1) - (a.salary_max_k ?? -1)) // 稳定排序，同薪资仍按发现时间
  $('#jobs').innerHTML = `<small>${list.length} 个</small>` + (list.map(jobCard).join('') || '<p><small>没有匹配的岗位</small></p>')
}

const targetPage = t => `${back('#/')}<h1>${esc(title(t))}</h1>
<a class="btn primary" href="#/i/${t.id}">🎤 开始模拟面试</a>
<h2>差距分析 <small>✅ 有力 ⚠️ 薄弱 ❌ 缺失</small></h2>
${t.gaps.map(g => `<div class=card><b>${icon(g)} ${esc(g.requirement)}</b>${g.evidence ? `<small>${esc(g.evidence)}</small>` : ''}<div>追问：${esc(g.probe)}</div></div>`).join('')}
<h2>定制简历</h2>
${t.tailored ? `<details><summary>查看定制版</summary><pre>${esc(t.tailored)}</pre><button onclick="copyTailored('${t.id}')">复制</button></details>` : ''}
<button onclick="tailor('${t.id}')">${t.tailored ? '重新生成' : '按 JD 生成定制简历'}</button>
<h2>面经情报</h2>
${t.intel ? `<pre>${esc(t.intel)}</pre>` : ''}
<textarea id=intel rows=4 placeholder="粘贴小红书 / 牛客面经原文，可多篇"></textarea>
<button onclick="addIntel('${t.id}')">AI 提炼</button>
<h2>练习记录</h2>
${[...t.sessions].reverse().map(s => `<a class=row href="#/s/${t.id}/${s.id}">${new Date(s.date).toLocaleString()}<span class=stars>${'★'.repeat(s.rating)}</span></a>`).join('') || '<small>暂无</small>'}
<button class=danger onclick="delTarget('${t.id}')">删除这个岗位</button>`

const interviewPage = t => `${back('#/t/' + t.id)}<h1>${esc(title(t))}</h1>
<div id=chat></div>
<div id=controls>
  <textarea id=answer rows=3 placeholder="语音或打字回答"></textarea>
  <button id=mic class=primary onclick="toggleMic()">🎙 语音回答</button>
  <button onclick="sendAnswer()">发送</button>
  <button onclick="endInterview()">结束面试</button>
</div>
<div id=review></div>`

const sessionPage = (t, sid) => {
  const s = t.sessions.find(s => s.id === sid)
  if (!s) return targetPage(t)
  return `${back('#/t/' + t.id)}<h1>复盘 · ${new Date(s.date).toLocaleString()}</h1>${reviewHTML(s.review)}
<h2>面试记录</h2>${s.messages.map(m => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('')}`
}

function route() {
  stopVoice()
  const [, page = '', id, sub] = location.hash.split('/')
  const t = id && target(id)
  $('#app').innerHTML =
    page === 'resume' ? resumePage()
    : page === 'jobs' ? jobsPage()
    : page === 'new' && S.resume ? newPage(id && J && J.find(j => j.id === decodeURIComponent(id)))
    : !t ? home()
    : page === 't' ? targetPage(t)
    : page === 'i' ? interviewPage(t)
    : page === 's' ? sessionPage(t, sub)
    : home()
  if (page === 'i' && t) startInterview(t)
  if (page === 'jobs') renderJobs()
  scrollTo(0, 0)
}

// ---------- 动作 ----------
async function importPDF(file) {
  if (!file) return
  withBusy(async () => {
    const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/'
    const pdfjs = await import(base + 'pdf.min.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      pages.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str + (x.hasEOL ? '\n' : '')).join(''))
    }
    const text = pages.join('\n').trim()
    if (!text) throw new Error('PDF 里没抽到文字（可能是扫描件），直接粘贴文字吧')
    $('#resume').value = text
  })
}

const saveResume = () => withBusy(async () => {
  S.resume = $('#resume').value.trim()
  await save()
  location.hash = '#/'
})

function analyze() {
  const [company, role, jd] = ['#company', '#role', '#jd'].map(s => $(s).value.trim())
  if (!company || !role || !jd) return alert('公司、岗位、JD 都要填')
  const [, page, jobId] = location.hash.split('/') // 从岗位雷达建的，记下来源岗位
  withBusy(async () => {
    const t = { id: crypto.randomUUID(), company, role, jd, gaps: [], tailored: '', intel: '', sessions: [],
      ...(page === 'new' && jobId && { jobId: decodeURIComponent(jobId) }) }
    t.gaps = (await askJSON(P.gaps, P.material(t))).gaps
    S.targets.push(t)
    await save()
    location.hash = '#/t/' + t.id
  })
}

const tailor = id => withBusy(async () => {
  const t = target(id)
  t.tailored = await chat(P.tailor, [{ role: 'user', content: P.material(t) }])
  await save()
  route()
})

function addIntel(id) {
  const raw = $('#intel').value.trim()
  if (!raw) return alert('先粘贴面经原文')
  withBusy(async () => {
    const t = target(id)
    const summary = await chat(P.intel(t), [{ role: 'user', content: raw }])
    t.intel = t.intel ? t.intel + '\n\n' + summary : summary
    await save()
    route()
  })
}

const copyTailored = id => navigator.clipboard.writeText(target(id).tailored).then(() => alert('已复制'))

function delTarget(id) {
  if (!confirm('删除这个岗位和它的所有练习记录？')) return
  withBusy(async () => {
    S.targets = S.targets.filter(t => t.id !== id)
    await save()
    location.hash = '#/'
  })
}

// ---------- 模拟面试 ----------
let iv = null // { t, messages, review }

function startInterview(t) {
  iv = { t, messages: [{ role: 'assistant', content: P.greeting }] }
  renderChat()
  speak(P.greeting)
}

function renderChat() {
  $('#chat').innerHTML = iv.messages.map((m, i) =>
    `<div class="msg ${m.role}" ${m.role === 'assistant' ? `onclick="speak(iv.messages[${i}].content)"` : ''}>${esc(m.content)}</div>`).join('')
  $('#answer').scrollIntoView({ block: 'end' })
}

function sendAnswer() {
  const text = $('#answer').value.trim()
  if (!text || busy) return
  $('#answer').value = ''
  iv.messages.push({ role: 'user', content: text })
  renderChat()
  withBusy(async () => {
    const reply = await chat(P.interviewer(iv.t), iv.messages)
    iv.messages.push({ role: 'assistant', content: reply })
    renderChat()
    speak(reply)
  })
}

function endInterview() {
  if (iv.messages.length < 3) return alert('至少答一轮再结束')
  stopVoice()
  withBusy(async () => {
    const transcript = iv.messages.map(m => (m.role === 'user' ? '候选人' : '面试官') + '：' + m.content).join('\n')
    iv.review = await askJSON(P.review, transcript)
    $('#controls').hidden = true
    $('#review').innerHTML = `<h2>复盘</h2>${reviewHTML(iv.review)}
<p>自评这一轮后保存：</p>${[1, 2, 3, 4, 5].map(n => `<button onclick="saveSession(${n})">${'★'.repeat(n)}</button>`).join('')}
<button class=danger onclick="location.hash='#/t/${iv.t.id}'">丢弃</button>`
    $('#review').scrollIntoView()
  })
}

const saveSession = rating => withBusy(async () => {
  target(iv.t.id).sessions.push({ id: crypto.randomUUID(), date: new Date().toISOString(), messages: iv.messages, review: iv.review, rating })
  await save()
  location.hash = '#/t/' + iv.t.id
})

// ---------- 语音：浏览器自带的识别和朗读 ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
let rec = null

function speak(text) {
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  speechSynthesis.speak(u)
}

function toggleMic() {
  if (rec) { rec.sendOnEnd = true; return rec.stop() } // 等最后一段结果到了再在 onend 里发送
  if (!SR) return alert('这个浏览器不支持语音识别，换 Safari / Chrome，或者直接打字')
  speechSynthesis.cancel()
  const r = rec = new SR()
  r.lang = 'zh-CN'
  r.continuous = true
  r.interimResults = true
  const before = $('#answer').value
  r.onresult = e => { $('#answer').value = before + [...e.results].map(x => x[0].transcript).join('') }
  r.onerror = e => { if (!['aborted', 'no-speech'].includes(e.error)) alert('语音识别出错：' + e.error) }
  r.onend = () => {
    rec = null
    if ($('#mic')) $('#mic').textContent = '🎙 语音回答'
    if (r.sendOnEnd) sendAnswer()
  }
  r.start()
  $('#mic').textContent = '⏹ 说完了'
}

function stopVoice() {
  if (rec) { rec.onend = null; rec.abort(); rec = null }
  speechSynthesis.cancel()
}

// ---------- 启动 ----------
addEventListener('hashchange', route)
// 切回前台时拉一次最新状态，避免另一台设备改过的数据被这边旧数据覆盖。
// 只有首页重新渲染：其他页可能正填着表单（切出去复制 JD 再回来）
const onHome = () => !location.hash || location.hash === '#/'
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || busy) return
  load().then(() => { if (onHome()) route() })
  loadJobs().then(() => { if (onHome()) route(); else renderJobs() })
})
load().then(route).catch(e => { $('#app').textContent = '连不上服务器：' + e.message })
// 岗位数据单独拉，慢了也不挡首页
loadJobs().then(() => { if (onHome() || location.hash.startsWith('#/jobs') || location.hash.startsWith('#/new/')) route() })
