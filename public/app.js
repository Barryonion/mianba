// 面霸前端：原生 JS，hash 路由，整份状态存服务端。
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const txt = v => Array.isArray(v) ? v.join('\n') : v // AI 偶尔把字符串字段返回成数组

// ---------- 主题：默认跟随系统，可手动锁定深/浅 ----------
const themeState = () => localStorage.getItem('mianba.theme') || 'auto'
function applyTheme() {
  const t = themeState()
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  let m = document.querySelector('meta[name="theme-color"]:not([media])')
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m) }
  m.content = dark ? '#1c1c1e' : '#f5f5f7'
}
function setTheme(t) { localStorage.setItem('mianba.theme', t); applyTheme(); route() }
applyTheme() // 脚本一加载就应用，避免闪一下系统主题
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeState() === 'auto') applyTheme() })

// ---------- 语言：默认中文，可切英文；UI 文案与 AI 输出语言都跟着走 ----------
const langState = () => localStorage.getItem('mianba.lang') || 'zh'
const L = (zh, en) => langState() === 'en' ? (en ?? zh) : zh // 内联双语：中文原文 + 英文对照，缺英文时回落中文
const voiceLang = () => langState() === 'en' ? 'en-US' : 'zh-CN' // 语音识别/朗读跟界面语言
const TABS = { home: ['首页', 'Home'], jobs: ['岗位', 'Jobs'], practice: ['练习', 'Practice'], me: ['我的', 'Me'] }
function applyLang() {
  document.documentElement.lang = langState() === 'en' ? 'en' : 'zh-CN'
  document.title = L('面霸', 'Mianba')
  document.querySelectorAll('#tabs a').forEach(a => { const p = TABS[a.dataset.t]; if (p) a.querySelector('.tlabel').textContent = L(...p) })
  const bl = $('#busylabel'); if (bl) bl.textContent = L('AI 思考中', 'AI thinking')
  const sb = document.querySelectorAll('#selbar .chip')
  if (sb.length === 2) { sb[0].textContent = L('📖 讲解', '📖 Explain'); sb[1].textContent = L('📒 记笔记', '📒 Save note') }
  const ls = $('#app .loading small'); if (ls) ls.textContent = L('加载中…', 'Loading…')
}
function setLang(l) { localStorage.setItem('mianba.lang', l); applyLang(); route() }
applyLang() // 静态骨架先翻好；页面内字符串在各自渲染处 L()，切语言走 route() 重画

// ---------- 划词讲解 + 概念笔记 ----------
let selInfo = null
document.addEventListener('selectionchange', () => {
  setTimeout(() => {
    const bar = $('#selbar')
    if (!bar) return
    const sel = getSelection()
    const t = sel?.toString().trim()
    const ok = t && t.length >= 3 && t.length <= 80 && sel.anchorNode?.parentElement?.closest?.('.md, .card')
    bar.classList.toggle('show', !!ok)
    if (ok) selInfo = { term: t, src: (document.querySelector('h1')?.textContent || '').replace(/^\d+\. /, '').trim() }
  }, 250)
})

function termExplain(el) { explainTerm(el.textContent.trim()) }

function explainTerm(term, src) {
  withBusy(async () => {
    const from = src || selInfo?.src || L('阅读中', 'Reading')
    const explain = await chat(`你是资深架构师和面试辅导。用 2-4 句话通俗讲解给出的概念，候选人系统档案里有对应实践就对照着讲；最后单独一行「面试视角：」给一句最关键的要点。简洁，中文。`,
      [{ role: 'user', content: `${L('概念', 'Concept')}: ${term}\n${L('来源', 'Source')}: ${from}${projectsBlock()}` }])
    // 每次讲解都入历史（同一个词重复讲也各记一条，靠时间区分）；sheet 直接展示这份记录，译文也挂在它上面
    S.explains ??= []
    const rec = { id: crypto.randomUUID(), term, explain, src: from, at: new Date().toISOString() }
    S.explains.push(rec)
    showSheet(rec)
    await save()
  })
}

// pin：固定期间讲解区不收起、层级最上，拖到哪儿就停哪儿；取消 pin 回默认底部
let sheetPin = false
function showSheet(rec) {
  const sh = $('#sheet')
  sh.innerHTML = `<div class="card md"><div class=shead id=shead><span class=shandle><b>${esc(rec.term)}</b> <small style="display:inline">${esc(rec.src)}</small></span><button class="chip ${sheetPin ? 'on' : ''}" onclick="togglePin()">📌</button></div>${md(rec.explain)}
${rec.en != null ? `<div class="md tren">${md(rec.en)}</div>` : transHTML(rec, `trExplain(this, '${rec.id}')`)}
<div class=chips><button class="chip on" onclick="noteTerm(${esc(JSON.stringify(rec.term))}, '', ${esc(JSON.stringify(rec.src))})">${L('📒 记到笔记', '📒 Save to notes')}</button><button class="chip" onclick="location.hash='#/history'">${L('🕘 历史', '🕘 History')}</button><button class="chip" onclick="hideSheet()">${L('收起', 'Dismiss')}</button></div></div>`
  sh.classList.add('show')
  bindSheetDrag()
}
function togglePin() {
  sheetPin = !sheetPin
  const sh = $('#sheet')
  sh?.classList.toggle('pin', sheetPin)
  sh?.querySelector('.shead .chip')?.classList.toggle('on', sheetPin)
  if (!sheetPin) resetSheetPos()
}
const resetSheetPos = () => { const sh = $('#sheet'); if (sh) sh.style.left = sh.style.top = sh.style.right = sh.style.bottom = sh.style.transform = sh.style.transition = '' }
const hideSheet = () => {
  if (sheetPin) { // pin 期间收起动作不生效
    getSelection()?.removeAllRanges?.()
    $('#selbar')?.classList.remove('show')
    return
  }
  $('#sheet')?.classList.remove('show')
  resetSheetPos()
  getSelection()?.removeAllRanges?.()
  $('#selbar')?.classList.remove('show')
}
// 拖动：抓标题区整块拖。Pointer Events 一套同时覆盖桌面鼠标和移动端触摸
function bindSheetDrag() {
  const sh = $('#sheet'), h = $('#shead')
  if (!sh || !h) return
  h.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || (e.button != null && e.button > 0)) return // 按钮上的按下留给点击
    const r = sh.getBoundingClientRect() // 从当前视觉位置接管，改成 left/top 绝对定位
    sh.style.transition = 'none' // 拖动中不做位移动画
    sh.style.left = r.left + 'px'; sh.style.top = r.top + 'px'
    sh.style.right = 'auto'; sh.style.bottom = 'auto'; sh.style.transform = 'none'
    const sx = e.clientX, sy = e.clientY
    h.setPointerCapture(e.pointerId) // 捕获后移出标题区也能继续拖
    const mv = ev => { // 别拖出屏幕
      sh.style.left = Math.min(Math.max(4, r.left + ev.clientX - sx), Math.max(4, innerWidth - r.width - 4)) + 'px'
      sh.style.top = Math.min(Math.max(4, r.top + ev.clientY - sy), Math.max(4, innerHeight - 24)) + 'px'
    }
    const up = () => {
      h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up)
      sh.style.transition = ''
    }
    h.addEventListener('pointermove', mv)
    h.addEventListener('pointerup', up)
    h.addEventListener('pointercancel', up)
  })
}

function noteTerm(term, explain, src) {
  withBusy(async () => {
    S.notes ??= []
    if (S.notes.some(n => n.term === term)) { hideSheet(); return alert(L('这个概念已在笔记本里', 'Already in your notes')) }
    S.notes.push({ id: crypto.randomUUID(), term, explain, src: src || selInfo?.src || '', at: new Date().toISOString() })
    await save()
    hideSheet()
    alert(L('已记入笔记本', 'Saved to notes'))
  })
}

let S = { resume: '', targets: [] }
let ready = false // state 没加载完不渲染，避免空状态闪现（这个窗口期保存会把数据清空）
let busy = false
let J = null // 岗位雷达：null 加载中，false 服务器没接巡检数据
const jf = { view: 'todo', sort: 'new', q: '' }

async function api(url, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}
// localStorage 缓存（手机走中继链路慢，缓存让第二次打开秒出页面；v 变了就作废重来）
const CACHE_V = 3
const cache = {
  get k() { return 'mianba.v' + CACHE_V },
  read() { try { return JSON.parse(localStorage.getItem(this.k) || 'null') } catch { return null } },
  write(d) { try { localStorage.setItem(this.k, JSON.stringify({ v: CACHE_V, d })) } catch { /* 装满就算了 */ } },
}
const load = async () => {
  S = await api('/api/state')
  cache.write({ state: S, jobs: J && J !== false ? J : cache.read()?.d?.jobs })
}
const save = () => api('/api/state', S, 'PUT').then(() => { cache.write({ state: S, jobs: J && J !== false ? J : cache.read()?.d?.jobs }) })
const loadJobs = () => api('/api/jobs').then(j => {
  J = j
  cache.write({ state: S, jobs: j })
}, () => { J = false })
// AI 一律中文回答：界面语言只管 UI 文案，不影响 AI 输出语言（英文界面 + 中文 AI 回答并存）。
// 指令追加在 system 末尾、优先级最高（要压过 prompt 正文里写死的语言要求）
const zhDirective = '\n\n（回答请全程使用中文。）'
const chat = async (system, messages) => (await api('/api/chat', { system: system + zhDirective, messages })).content
async function askJSON(system, user) {
  const { content } = await api('/api/chat', { system: system + zhDirective, messages: [{ role: 'user', content: user }], json: true })
  try { return JSON.parse(content.replace(/```json|```/g, '').trim()) } catch { throw new Error(L('AI 返回格式不对，再试一次', 'AI returned an unexpected format, try again')) }
}
const target = id => S.targets.find(t => t.id === id)
const title = t => `${t.company} · ${t.role}`

async function withBusy(fn) {
  if (busy) return
  busy = true
  document.body.classList.add('busy')
  // 挂个秒数计时：长回答时能看出还在跑，不是卡死
  const t0 = Date.now()
  const tick = setInterval(() => { const el = $('#busysec'); if (el) el.textContent = Math.round((Date.now() - t0) / 1000) + ' s' }, 1000)
  try { await fn() } catch (e) { alert(e.message) } finally { busy = false; clearInterval(tick); document.body.classList.remove('busy') }
}

// ---------- 按需翻译：对话消息与划词讲解的「译 EN」，译文存记录的 en 字段随 state 持久化 ----------
// 翻译按钮就地把自身替换成英文区，不整页重画（不打断输入框草稿和滚动位置）；已译（en 非空）不再调 LLM
async function translateRec(btn, rec) {
  if (!rec || rec.en != null) return
  withBusy(async () => {
    btn.disabled = true
    btn.textContent = L('译 EN…', 'Translating…')
    try {
      // 翻译要输出英文，绕开 chat() 的恒定中文指令，单独直调
      const { content } = await api('/api/chat', { system: P.trans, messages: [{ role: 'user', content: rec.explain ?? rec.content }] })
      rec.en = content
      await save()
      btn.outerHTML = `<div class="md tren">${md(rec.en)}</div>`
    } finally {
      // save 抛错时上面的 outerHTML 替换不会执行、按钮仍挂在 DOM 上停在忙碌态：
      // en 已有值就就地补上英文区（与切页重画所见一致，也避免恢复出一个点了没反应的按钮——
      // 顶部 en!=null 守卫会拦住重译）；否则（LLM 调用失败）恢复按钮可再点。
      // save 成功时按钮已被 outerHTML 替换脱离 DOM（isConnected=false），无事可做。
      if (btn.isConnected) {
        if (rec.en == null) { btn.disabled = false; btn.textContent = L('译 EN', 'Translate to EN') }
        else btn.outerHTML = transHTML(rec)
      }
    }
  })
}
// 各页按钮的数据定位：点击时从 S 现取（切页/重载后仍指向最新对象）
const trGapMsg = (btn, i) => translateRec(btn, curGap().g?.chat?.[i])
const trDrillMsg = (btn, id, i) => translateRec(btn, domOf(id)?.chat?.[i])
const trIvMsg = (btn, i) => translateRec(btn, iv?.messages?.[i])
const trSessionMsg = (btn, tid, sid, i) => translateRec(btn, target(tid)?.sessions?.find(s => s.id === sid)?.messages?.[i])
const trExplain = (btn, id) => translateRec(btn, (S.explains || []).find(e => e.id === id))
// 未译给按钮（stopPropagation：别触发消息气泡上的朗读），已译给中文下方的英文区
const transHTML = (rec, onclick) => rec.en != null
  ? `<div class="md tren">${md(rec.en)}</div>`
  : `<button class="chip" onclick="event.stopPropagation();${onclick}">${L('译 EN', 'Translate to EN')}</button>`

// ---------- Prompts ----------
// 项目档案：从公司机器的会话历史和仓库提取的「事实卡」，AI 回答只允许引用这里的真实细节
const projectsBlock = () => S.projects?.length
  ? `\n\n<项目档案（候选人的真实项目细节，回答时优先引用，档案里没有的数字不要编造）>\n${S.projects.map(p => `【${p.name}】\n${p.facts}`).join('\n\n')}\n</项目档案>`
  : ''
const P = {
  material: t => `<候选人简历>\n${S.resume}\n</候选人简历>\n\n<岗位JD>\n${t.jd}\n</岗位JD>\n${projectsBlock()}`,
  gaps: `你是资深技术面试官。对照 JD 和候选人简历，拆出 JD 的 5-10 条核心要求，逐条判断简历能否证明。
输出严格 JSON：{"gaps":[{"requirement":"JD 要求","evidence":"简历中能证明它的具体经历，没有就空字符串","strength":"strong|weak|none","probe":"面试官针对这一条最可能的追问，一句话"}],"domains":"这个岗位涉及的业务领域，每行一个，共 3-6 个，如：支付结算、订单履约、身份权限、库存调度、风控、数据同步、营销优惠。只写领域名"}
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
${t.gaps.filter(g => g.strength !== 'strong').map(g => `- ${g.requirement}：${g.probe}${g.study ? '（候选人准备过这条，往深处验证真实掌握程度）' : ''}`).join('\n')}

## 面经情报
${t.intel || '无'}`,
  review: t => `你是面试复盘教练。下面是一场模拟面试记录和面试官的追问清单。输出严格 JSON，格式为 {"verdict":"...","weak":"...","better":"...","missed":"..."}，
四个字段都是字符串，多条内容在字符串内用换行分隔，不要用数组：
verdict：如果是真实面试能否通过、为什么（2-3 句）；
weak：回答最薄弱的 2-4 处，指出问题所在；
better：针对这几处给出更好的回答思路或示例；
missed：追问清单里这场面试真正被问到、且候选人没答好或没答到的条目，每行照抄一条清单里的要求原文；没问到的和答好了的都不要列；都答好了就空字符串。

## 追问清单
${t.gaps.filter(g => g.strength !== 'strong').map(g => `- ${g.requirement}`).join('\n')}`,
  study: `你是资深技术面试辅导老师。用户会给出简历、JD、JD 中的一条要求，以及面试官针对这条要求的追问。帮候选人准备这道追问。
输出严格 JSON，格式为 {"concepts":[{"name":"概念名","explain":"解释"}],"approach":"回答思路"}：
concepts：4-6 个回答这道追问必须讲清楚的相关领域概念，explain 用 2-3 句话说清是什么、面试常考什么；
approach 是字符串，多条内容在字符串内用换行分隔，不要用数组：先给回答结构（先说什么后说什么），再指出简历里哪段真实经历可以拿来举例；简历里没有的不要编造，改为建议如何诚实回答并展示补齐思路。`,
  tutor: (t, g) => `你是资深技术面试辅导老师，正在陪候选人准备下面这条岗位要求。中文回答，结构清楚、简洁，可以用列表和短代码。
要在手机上读：少用表格、标题不超过两级、段落短。解释概念时讲清原理、面试常见追问和易错点；给回答思路或示例时，只用简历里的真实经历，不编造；候选人自己作答时，直接指出问题并给出改进版。

${P.material(t)}

## 当前要求
${g.requirement}
简历证据：${g.evidence || '无'}
面试官追问：${g.probe}`,
  outlineGen: `你是技术学习路径设计师。为指定业务领域设计一门「面试深学课程」的学习地图。输出严格 JSON：{"sections":[{"t":"节标题"}]}，不要数组套数组。
固定框架、共 12-15 节，节标题里带上具体对象：
- 1 节领域全貌（业务流程、参与角色、核心概念一览）
- 3-5 节核心实体深读，每节一个实体，标题形如「实体深读：账变流水」
- 2-4 节主流方案深读，每节一个方案并点名（如「方案深读：支付宝账务体系」「方案深读：复式记账/Beancount 模型」「方案深读：美团结算中心」）
- 2-3 节关键难题专题，标题形如「难题专题：幂等与去重」
- 1 节横向对比与选型决策树
标题不超过 20 字，不要编号（程序会加）`,
  sectionGen: `你是资深架构师和面试辅导，为候选人写领域课程的其中一节，纯 markdown、2000-3000 字、由浅入深，按节的类型组织：
- 实体深读：是什么、职责边界、生命周期与状态、与其他实体/模块的关系、设计陷阱
- 方案深读：这家方案的架构拆解（分层讲清）、为什么这么设计（约束与取舍）、适用场景、优缺点、可借鉴点
- 难题专题：问题本质、主流解法对比（各自的代价）、工程落地细节、常见错误
- 全貌/对比节：对比用表格；对比节给按业务约束选型的决策树（文字版）
候选人项目档案有相关实践时，标注「↩ 你项目的实践：<对照说明>」。
正文中把 3-6 个最关键的概念用 [[概念名]] 标注（各只标第一次出现）。
结尾固定两段：「## 理解检查」（2 道题，不要答案）、分隔线、「### 参考答案要点」（每题 3-5 行要点）。`,
  domainGen: `你是资深架构师和面试辅导。为指定的业务领域写一张「领域建模知识卡」，纯 markdown、控制在 1200 字内，固定四段：
## 核心概念与实体关系
主要实体、聚合/模块怎么划分、关键状态机或账务口径
## 常见建模套路
该领域通用的设计方案与取舍；候选人项目档案里有真实实践的必须标注「↩ 你项目的实践：<对应做法>」
## 主流方案
业界代表性做法作参照：大厂公开分享的方案（点名公司与要点）、成熟开源项目、主流云服务，各一行带适用场景；和上面套路的差异点一句带过
## 面试常见建模题
5 道，每行以「- 」开头，一行一道
## 通用陷阱
幂等、并发、对账、越权等该领域高频翻车点
只引用项目档案里真实存在的实践，档案里没有的不标。`,
  drill: d => `你是资深架构师面试官，考察候选人「${d.name}」领域的系统建模能力。中文。
先出一道真实感的建模设计题（参考下面的知识卡，不要与对话里出过的重复），一句话场景即可；候选人给方案后，就并发、幂等、一致性、扩展性中最薄弱处追问 2-3 层；追问完再点评（好的地方、漏洞、更优方案）。每次只提一个问题，不要自己给答案。

<领域知识卡>
${d.facts || '（还没有知识卡内容）'}
</领域知识卡>${projectsBlock()}`,
  greeting: () => L('你好，我是今天的面试官。先做个简单的自我介绍吧，重点讲讲和这个岗位相关的经历。', "Hi, I'm today's interviewer. Let's start with a quick self-introduction — focus on the experience most relevant to this role."),
  trans: `你是翻译引擎。把用户给的中文内容忠实译成英文：只输出译文本身，不解释、不增删、不改写，保留原有的 markdown 结构。`,
}

// ---------- 页面 ----------
// 顶部吸顶返回栏，滚动长页面时随时能回去
const loading = (t = L('加载中…', 'Loading…')) => `<div class=loading><span class=spin></span><small>${esc(t)}</small></div>`
const back = (href, label = L('返回', 'Back')) => `<div class=top><a href="${href}">‹ ${esc(label)}</a></div>`
// 差距分析计数：✅ 有力 ⚠️ 薄弱 ❌ 缺失，外加已准备（生成过概念讲解）的条数
const tally = t => ({ strong: t.gaps.filter(g => g.strength === 'strong').length, weak: t.gaps.filter(g => g.strength === 'weak').length,
  none: t.gaps.filter(g => !['strong', 'weak'].includes(g.strength)).length, studied: t.gaps.filter(g => g.study).length })
const pills = c => `<span class="pill bad">❌ ${c.none}</span><span class="pill warn">⚠️ ${c.weak}</span><span class="pill ok">✅ ${c.strong}</span>`
const icon = g => ({ strong: '✅', weak: '⚠️' })[g.strength] || '❌'
// 极简 Markdown：先 esc 整段，再在转义后的文本上识别标题、表格、代码块、引用、分隔线、粗体、行内代码，不会引入任意 HTML
const mdInline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
function md(s) {
  const out = [], lines = esc(s).split('\n')
  const inline = l => l.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[\[(.+?)\]\]/g, "<span class=term onclick='termExplain(this)'>$1</span>")
  const isRow = l => /^\s*\|/.test(l)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    let m
    if (/^\s*```/.test(l)) {
      const code = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
      out.push(`<pre class=code>${code.join('\n')}</pre>`)
    } else if (/^\s*[-*•]\s+/.test(l)) {
      const items = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++ }
      i--
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`)
    } else if (/^\s*\d+[.、]\s*/.test(l)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.、]\s*/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.、]\s*/, '')); i++ }
      i--
      out.push(`<ol>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`)
    } else if (isRow(l)) {
      const rows = []
      for (; i < lines.length && isRow(lines[i]); i++) {
        if (!/^\s*\|[\s:|-]+$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|'))
      }
      i--
      out.push(`<div class=tbl><table>${rows.map((r, k) => `<tr>${r.map(c => k ? `<td>${inline(c.trim())}</td>` : `<th>${inline(c.trim())}</th>`).join('')}</tr>`).join('')}</table></div>`)
    } else if ((m = l.match(/^#{1,6}\s+(.*)/))) out.push(`<div class=mh>${inline(m[1])}</div>`)
    else if (/^\s*([-*_])\1{2,}\s*$/.test(l)) out.push('<hr>')
    else if ((m = l.match(/^&gt;\s?(.*)/))) out.push(`<blockquote>${inline(m[1])}</blockquote>`)
    else out.push(l.trim() ? `<div>${inline(l)}</div>` : '<div class=gap></div>')
  }
  return out.join('')
}
const gapOf = (tid, i) => target(tid)?.gaps[i]
const reviewHTML = (r, saving) => [[L('🎯 能否通过', '🎯 Verdict'), r.verdict], [L('⚠️ 薄弱回答', '⚠️ Weak answers'), r.weak], [L('✨ 更好的答法', '✨ Better answers'), r.better],
  ...(txt(r.missed) ? [[L('🔁 这场没答好', '🔁 Missed this round'), `${txt(r.missed)}${saving ? '\n' + L('（保存后这些条目会标记「模拟没答好」）', '(will be marked "missed in mocks" after saving)') : '\n' + L('（这些条目已标记「模拟没答好」）', '(marked "missed in mocks")')}`]] : [])]
  .map(([h, v]) => `<div class=card><b>${h}</b><div class=md>${v ? md(txt(v)) : `<small>${L('（AI 没给出这一项）', '(AI skipped this one)')}</small>`}</div></div>`).join('')

// 巡检时间是北京时间字符串 "2026-11-02 10:31:41"
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
const when = s => s ? (s.startsWith(today()) ? L('今天 ', 'Today ') : s.slice(5, 11)) + s.slice(11, 16) : ''
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '#'
const join = (a, sep = ' · ') => a.filter(Boolean).join(sep)
const jobTarget = j => S.targets.find(t => t.jobId === j.id)
// 投递进度：t.stages = [{ s, at, note? }]，按时间追加；当前阶段取最后一条（文案做成函数，渲染时按当前语言取）
const STAGES = () => ({ applied: L('📮 已投递', '📮 Applied'), test: L('📝 笔试', '📝 Assessment'), i1: L('1️⃣ 一面', '1️⃣ Round 1'), i2: L('2️⃣ 二面', '2️⃣ Round 2'), i3: L('3️⃣ 三面', '3️⃣ Round 3'), hr: L('🤝 HR 面', '🤝 HR round'), offer: L('🎉 Offer', '🎉 Offer'), reject: L('❌ 终止', '❌ Closed') })
const stageNow = t => t.stages?.length ? STAGES()[t.stages.at(-1).s] : ''
// 岗位标记存在面霸自己的 state 里（S.jobMarks[岗位 id] = { s, at }），巡检库保持只读
const MARKS = () => ({ star: L('⭐ 收藏', '⭐ Starred'), applied: L('📮 已投递', '📮 Applied'), skip: L('🙅 不合适', '🙅 Not a fit') })
const markOf = j => S.jobMarks?.[j.id]?.s
// 待看：符合条件且还没标记；全部：包括不符合条件的
const VIEWS = () => ({ todo: [L('待看', 'To review'), j => j.matched && !markOf(j)], star: [L('收藏', 'Starred'), j => markOf(j) === 'star'],
  applied: [L('已投递', 'Applied'), j => markOf(j) === 'applied'], skip: [L('不合适', 'Not a fit'), j => markOf(j) === 'skip'], all: [L('全部', 'All'), () => true] })

// 今明两天的笔试/面试场数（和 daily.js 的提醒同一口径）
const upcomingInterview = () => {
  const day = off => new Date(Date.now() + off * 86400e3).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
  return (S.targets || []).flatMap(t => t.stages || []).filter(e => ['test', 'i1', 'i2', 'i3', 'hr'].includes(e.s) && [day(0), day(1)].includes((e.at || '').slice(0, 10))).length
}
const avatarColor = n => `hsl(${[...n].reduce((a, c) => a + c.codePointAt(0), 0) % 360}, 50%, 42%)`

const home = () => {
  const todo = J === null ? null : J === false ? null : J.filter(VIEWS().todo[1]).length
  const fresh = J ? J.filter(j => j.matched && j.first_seen?.startsWith(today())).length : 0
  const studied = S.targets.reduce((a, t) => a + t.gaps.filter(g => g.study).length, 0)
  const gapsN = S.targets.reduce((a, t) => a + t.gaps.length, 0)
  const iv = upcomingInterview()
  return `<h1>${L('面霸', 'Mianba')}</h1>
<div class="tiles sm">
  <a class="card tile" href="#/jobs"><small>${L('待看岗位', 'To review')}</small><b>${todo ?? '…'}</b></a>
  <a class="card tile" href="#/jobs"><small>${L('今日新', 'New today')}</small><b>${fresh || '0'}</b></a>
  <a class="card tile" href="#/"><small>${L('已准备', 'Prepared')}</small><b>${studied}<i>/${gapsN}</i></b></a>
  <a class="card tile" href="#/"><small>${L('今明面试', 'Interviews')}</small><b class="${iv ? 'hot' : ''}">${iv || L('无', '0')}</b></a>
  <a class="card tile" href="#/practice"><small>${L('待复习', 'Due')}</small><b class="${dueItems().length ? 'hot' : ''}">${dueItems().length}</b></a>
</div>
<h2>${L('目标岗位', 'Target roles')}</h2>
${S.targets.map(t => { const c = tally(t); const p = t.gaps.length ? Math.round(c.studied / t.gaps.length * 100) : 0
  return `<a class="row tcard" href="#/t/${t.id}">
  <span class="avatar" style="background:${avatarColor(t.company)}">${esc(t.company[0] || L('职', 'J'))}</span>
  <span class=tmain><b>${esc(t.company)}</b> · ${esc(t.role)}
    <div class=meta>${pills(c)}<span>${L(`模拟 ${t.sessions.length} 次`, `${t.sessions.length} mock${t.sessions.length === 1 ? '' : 's'}`)}</span></div>
    <span class="pbar"><i style="width:${p}%"></i></span></span>
  ${stageNow(t) ? `<span class="pill ${t.stages.at(-1).s === 'offer' ? 'ok' : ''}">${stageNow(t)}</span>` : ''}
  </a>` }).join('') || `<small>${L('还没有目标岗位，从岗位雷达里建一个', 'No target roles yet — create one from the job radar')}</small>`}
${S.resume ? `<a class="btn primary wide" href="#/new">${L('＋ 新建目标岗位', '+ New target role')}</a>` : ''}`
}

const domainsPage = () => `${back('#/')}<h1>${L('领域建模', 'Domain modeling')}</h1>
${S.domains?.map(d => { const qn = (d.quiz || '').split('\n').filter(Boolean).length
  return `<a class="row more" href="#/d/${d.id}"><b>${esc(d.name)}</b><small>${L(`${qn} 道建模题 · 对话 ${(d.chat || []).length} 条`, `${qn} design questions · ${(d.chat || []).length} messages`)}</small></a>` }).join('') || `<small>${L('还没有领域卡。到目标岗位页「从 JD 识别领域」后生成，或直接添加', "No domain cards yet — generate from a target role's JD, or add one below")}</small>`}
<a class="btn primary" href="#/d/new">${L('＋ 添加领域', '+ Add domain')}</a>`

const domainPage = (id, qi) => {
  if (id === 'new') return `${back('#/domains')}<h1>${L('添加领域', 'Add domain')}</h1>
<input id=dname placeholder="${esc(L('领域名，如：账务结算', 'Domain name, e.g. Payment Settlement'))}"><textarea id=dfacts rows=16 placeholder="${esc(L('知识卡内容，可留空后用「生成知识卡」', 'Knowledge card content — can be empty and generated later'))}"></textarea>
<button class=primary onclick="addDomain()">${L('保存', 'Save')}</button>`
  const d = S.domains?.find(x => x.id === id)
  if (!d) return domainsPage()
  const done = (d.outline || []).filter((_, i) => S.practice?.items[`ds:${d.id}:${i}`]?.m === 2).length
  const stat = i => ({ [undefined]: '⬜', 0: '❌', 1: '⚠️', 2: '✅' })[S.practice?.items[`ds:${d.id}:${i}`]?.m]
  return `${back('#/domains')}<h1>${esc(d.name)} <small>${d.outline ? L(`课程 · 已掌握 ${done}/${d.outline.length} 节`, `Course · ${done}/${d.outline.length} mastered`) : L('课程', 'Course')}</small></h1>
${d.outline ? d.outline.map((x, i) => `<a class="row more" href="#/ds/${d.id}/${i}"><b>${stat(i)} ${i + 1}. ${esc(x.t)}</b><small>${d.sections?.[i] ? Math.round(d.sections[i].content.length / 1000) + L('K 字 · ', 'K chars · ') + (S.practice?.items[`ds:${d.id}:${i}`]?.m != null ? L('已学', 'studied') : L('已生成待学', 'generated, unread')) : L('未生成', 'not generated')}</small></a>`).join('')
: `<div class=card><small>${L('先按领域生成学习地图（12-15 节：全貌 → 实体深读 → 主流方案深读 → 难题专题 → 对比决策）', 'Generate a learning map first (12-15 sections: overview → entity deep dives → real-world design deep dives → hard-problem topics → comparison & decision tree)')}</small><button class=primary onclick="genOutline('${d.id}')">${L('生成学习地图', 'Generate learning map')}</button></div>`}
<details><summary>${L('快速概览（单页知识卡）', 'Quick overview (one-page knowledge card)')}</summary><div class="card md">${d.facts ? md(d.facts) : `<small>${L('还没有', 'Nothing yet')}</small>`}</div>
<button onclick="genDomainCard('${d.id}')">${d.facts ? L('重新生成知识卡', 'Regenerate knowledge card') : L('生成知识卡', 'Generate knowledge card')}</button>
<details><summary>${L('编辑', 'Edit')}</summary><textarea id=dfacts rows=16>${esc(d.facts || '')}</textarea><button onclick="saveDomainFacts('${d.id}')">${L('保存', 'Save')}</button></details></details>
<h2>${L('考我', 'Quiz me')} <small>${L('AI 出建模题，答完追问再点评', 'AI poses a design question, follows up, then critiques')}</small>${d.chat?.length ? `<button class="link danger" onclick="clearDrill('${d.id}')">${L('清空对话', 'Clear chat')}</button>` : ''}</h2>
<div id=chat>${(d.chat || []).map((m, i) => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg assistant md">${md(m.content)}${transHTML(m, `trDrillMsg(this, '${d.id}', ${i})`)}</div>`).join('') || `<small>${L('点「出一道建模题」开始', 'Tap "Give me a question" to start')}</small>`}</div>
<div class=composer>
<div class=chips><button class=chip onclick="askDrill('${d.id}', '${L('出一道建模题', 'Give me a question')}')">${L('出一道建模题', 'Give me a question')}</button><button class=chip onclick="askDrill('${d.id}', '${L('换一道更难或更偏工程落地的', 'A harder or more engineering-heavy one')}')">${L('换一道难的', 'A harder one')}</button></div>
<div class=bar><textarea id=answer rows=1 placeholder="${esc(L('答它出的题，或直接描述你的方案让它点评', 'Answer its question, or describe your design for critique'))}" oninput="grow(this)"></textarea><button class=primary onclick="askDrillSend('${d.id}')">${L('发送', 'Send')}</button></div>
${(d.chat || []).length ? assess(`dq:${d.id}:${qi ?? 0}`) : ''}
</div>`
}

const sectionPage = (id, i) => {
  const d = domOf(id)
  const sec = d?.sections?.[i]
  return `${back('#/d/' + id, d.name)}<h1>${i + 1}. ${esc(d.outline?.[i]?.t || '...')}</h1>
${sec ? `<div class="card md">${md(sec.content)}</div>
<div class=chips><button class="chip" onclick="drillSection('${id}', ${i})">${L('🎤 就这节考我', '🎤 Quiz me on this')}</button></div>
${assess(`ds:${id}:${i}`)}` : `${loading(L('正在生成本节内容（约 1 分钟）…', 'Generating this section (about 1 min)…'))}
<button onclick="genSection('${id}', ${i})">${L('重新生成', 'Regenerate')}</button>`}
`
}

const projectsPage = () => `${back('#/')}<h1>${L('项目档案', 'Project profiles')}</h1>
${S.projects?.map(p => `<a class="row more" href="#/p/${p.id}"><b>${esc(p.name)}</b><small>${esc((p.facts || '').slice(0, 60))}…</small></a>`).join('') || `<small>${L('还没有项目档案。建议每个主力项目一张卡：背景、架构、你的职责、关键决策、量化数字、踩坑', 'No project profiles yet. One card per core project: context, architecture, your role, key decisions, metrics, pitfalls')}</small>`}
<a class="btn primary" href="#/p/new">${L('＋ 添加项目', '+ Add project')}</a>`

const projectPage = id => {
  if (id === 'new') return `${back('#/projects')}<h1>${L('添加项目', 'Add project')}</h1>
<input id=pname placeholder="${esc(L('项目名，如：合伙云·结算服务', 'Project name, e.g. Settlement Service'))}"><textarea id=pfacts rows=20 placeholder="${esc(L('项目事实卡：背景、架构、我的职责、关键决策与权衡、量化数字、踩坑与排查', 'Project fact card: context, architecture, my role, key decisions and trade-offs, metrics, pitfalls and debugging'))}"></textarea>
<button class=primary onclick="saveProject()">${L('保存', 'Save')}</button>`
  const p = S.projects?.find(x => x.id === id)
  if (!p) return projectsPage()
  return `${back('#/projects')}<h1>${esc(p.name)}</h1>
<div class="card md">${md(p.facts || L('（空）', '(empty)'))}</div>
<details><summary>${L('编辑', 'Edit')}</summary>
<input id=pname value="${esc(p.name)}"><textarea id=pfacts rows=20>${esc(p.facts)}</textarea>
<button class=primary onclick="saveProject('${p.id}')">${L('保存', 'Save')}</button></details>
<button class=danger onclick="delProject('${p.id}')">${L('删除这个项目', 'Delete this project')}</button>`
}

const saveProject = id => withBusy(async () => {
  const name = $('#pname').value.trim(), facts = $('#pfacts').value.trim()
  if (!name || !facts) return alert(L('项目名和事实卡都要填', 'Both project name and fact card are required'))
  S.projects ??= []
  if (id) Object.assign(S.projects.find(p => p.id === id), { name, facts })
  else S.projects.push({ id: crypto.randomUUID(), name, facts })
  await save()
  location.hash = '#/projects'
})

const delProject = id => {
  if (!confirm(L('删除这个项目档案？', 'Delete this project profile?'))) return
  withBusy(async () => {
    S.projects = S.projects.filter(p => p.id !== id)
    await save()
    location.hash = '#/projects'
  })
}

const mePage = () => `<h1>${L('我的', 'Me')}</h1>
<h2>${L('外观', 'Appearance')}</h2>
<div class="card">
<div class=chips>${[['auto', L('🌓 跟随系统', '🌓 Auto')], ['light', L('☀️ 浅色', '☀️ Light')], ['dark', L('🌙 深色', '🌙 Dark')]].map(([v, n]) =>
  `<button class="chip ${themeState() === v ? 'on' : ''}" onclick="setTheme('${v}')">${n}</button>`).join('')}</div>
<div class=chips>${[['zh', '中文'], ['en', 'English']].map(([v, n]) =>
  `<button class="chip ${langState() === v ? 'on' : ''}" onclick="setLang('${v}')">${n}</button>`).join('')}</div>
</div>
<a class="row more" href="#/resume">📄 ${L('我的简历', 'My resume')}<small>${S.resume ? L(`已录入 ${S.resume.length} 字`, `${S.resume.length} chars saved`) : L('还没添加', 'Not added yet')}</small></a>
<a class="row more" href="#/projects">📦 ${L('项目档案', 'Project profiles')}<small>${L(`${S.projects?.length || 0} 个 · AI 回答会引用的真实项目细节`, `${S.projects?.length || 0} cards · real project details the AI cites in answers`)}</small></a>
<a class="row more" href="#/market">📈 ${L('行情', 'Market')}<small>${L('薪资分布、技能要求 TOP、区域行情', 'Salary distribution, top skills, areas')}</small></a>
<a class="row more" href="#/notes">📒 ${L('概念笔记', 'Concept notes')}<small>${L(`${S.notes?.length || 0} 条 · 阅读时划词收藏的概念`, `${S.notes?.length || 0} saved · terms collected while reading`)}</small></a>
<a class="row more" href="#/history">📖 ${L('讲解历史', 'Explanations')}<small>${L(`${S.explains?.length || 0} 条 · 划词「讲解」过的都记着`, `${S.explains?.length || 0} records · every "Explain" tap is logged`)}</small></a>`

const resumePage = () => `${back('#/')}<h1>${L('我的简历', 'My resume')}</h1>
<label class=btn>${L('导入 PDF', 'Import PDF')}<input type=file accept=application/pdf hidden onchange="importPDF(this.files[0])"></label>
<textarea id=resume rows=20 placeholder="${esc(L('粘贴简历文字，或导入 PDF', 'Paste resume text, or import a PDF'))}">${esc(S.resume)}</textarea>
<button class=primary onclick="saveResume()">${L('保存', 'Save')}</button>`

const jdDraft = j => `${join([j.job_name, j.salary_desc, join([j.area, j.business_area], ''), j.experience, j.degree], L('｜', ' | '))}
${L('技能标签：', 'Skills: ')}${j.skills || L('无', 'None')}

${j.jd || L('（职位描述还没抓到：打开 BOSS 岗位详情，把完整职位描述粘贴到这里替换这一行，分析会准得多）', '(No JD captured yet: open the job on BOSS and paste the full description here to replace this line — the analysis will be far more accurate)')}`

const newPage = j => `${back(j ? '#/jobs' : '#/')}<h1>${L('新建目标岗位', 'New target role')}</h1>
<input id=company placeholder="${esc(L('公司', 'Company'))}" value="${esc(j?.brand_name)}"><input id=role placeholder="${esc(L('岗位', 'Role'))}" value="${esc(j?.job_name)}">
${j && !j.jd ? `<a class=btn href="${esc(safeUrl(j.url))}" target=_blank rel=noopener>${L('去 BOSS 复制完整 JD ›', 'Open BOSS to copy the full JD ›')}</a>` : ''}
<textarea id=jd rows=14 placeholder="${esc(L('整段粘贴 JD', 'Paste the full JD'))}">${j ? esc(jdDraft(j)) : ''}</textarea>
<button class=primary onclick="analyze()">${L('分析差距', 'Analyze gaps')}</button>`

const jobsPage = () => `${back('#/')}<h1>${L('岗位雷达', 'Job radar')} <button class=link onclick="location.hash='#/market'">${L('行情 ›', 'Market ›')}</button></h1>
${J === null ? loading() : J === false ? `<small>${L('服务器没接巡检数据（JOBS_DB）', 'Server has no job data (JOBS_DB not configured)')}</small>` : `
<input id=jq type=search placeholder="${esc(L('搜公司 / 职位 / 技能 / 区域 / 职位描述', 'Search company / title / skills / area / JD'))}" value="${esc(jf.q)}" oninput="jf.q = this.value; renderJobs()">
<div class=chips>${Object.entries(VIEWS()).map(([k, [name, f]]) => `<button class="chip ${jf.view === k ? 'on' : ''}" onclick="jf.view = '${k}'; renderJobs(this)">${name} ${J.filter(f).length}</button>`).join('')}</div>
<div class=chips><button class="chip ${jf.sort === 'new' ? 'on' : ''}" onclick="jf.sort = 'new'; renderJobs(this)">${L('按发现时间', 'Newest first')}</button><button class="chip ${jf.sort === 'pay' ? 'on' : ''}" onclick="jf.sort = 'pay'; renderJobs(this)">${L('按薪资上限', 'Top salary')}</button><button class="chip ${jf.sort === 'score' ? 'on' : ''}" onclick="jf.sort = 'score'; renderJobs(this)">${L('按匹配度', 'Best match')}</button></div>
<div id=jobs></div>`}`

const jobCard = j => {
  const t = jobTarget(j)
  const mk = S.jobMarks?.[j.id]
  return `<div class=card id="job-${esc(j.id)}">
<span class="pay ${j.salary_desc ? "" : "na"}">${esc(j.salary_desc || L('面议', 'Negotiable'))}</span>${j.score != null ? `<span class="sc ${j.score >= 75 ? 'ok' : j.score >= 50 ? 'warn' : ''}">${j.score}</span>` : ''}<b>${j.first_seen?.startsWith(today()) ? `<span class=new>${L('新', 'NEW')}</span> ` : ''}${esc(j.job_name)}</b>
<small>${esc(join([j.brand_name, j.brand_scale, j.brand_stage, j.brand_industry]))}</small>
<small>${esc(join([join([j.area, j.business_area], ''), j.experience, j.degree, j.boss_name && join([j.boss_name, j.boss_title], ' ')]))}</small>
${j.skills ? `<div class=tags>${j.skills.split(',').slice(0, 10).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
${j.score_reason ? `<small class=why>${j.score}${L(' 分：', ' pts: ')}${esc(j.score_reason)}</small>` : ''}
${j.jd ? `<details><summary>${L('职位描述', 'JD')}</summary><pre>${esc(j.jd)}</pre></details>` : ''}
<small>${L('首次发现', 'First seen')} ${when(j.first_seen)} · ${L(`出现 ${j.seen_count} 次`, `seen ${j.seen_count}×`)}${j.pushed ? ' · ' + L('已推送', 'pushed') : ''}${j.matched ? '' : ' · ' + L('不符合条件', 'not qualified')}${mk ? ` · ${MARKS()[mk.s]} ${new Date(mk.at).toLocaleDateString()}` : ''}</small>
<a class=btn href="${esc(safeUrl(j.url))}" target=_blank rel=noopener>${L('去 BOSS 看', 'Open in BOSS')}</a>
${t ? `<a class=btn href="#/t/${t.id}">${L('已建目标 ›', 'Target role ›')}</a>` : `<a class="btn primary" href="#/new/${encodeURIComponent(j.id)}">${L('建为目标岗位', 'Create target role')}</a>`}
<div class=chips>${Object.entries(MARKS()).map(([s, name]) => `<button class="chip ${mk?.s === s ? 'on' : ''}" onclick="markJob(${esc(JSON.stringify(j.id))}, '${s}')">${name}</button>`).join('')}</div>
</div>`
}

// 只重画列表，搜索框不丢焦点；传入按钮时顺便重画按钮状态
function renderJobs(btn) {
  if (btn) return route()
  if (!$('#jobs') || !J) return
  const q = jf.q.trim().toLowerCase()
  const list = J.filter(j => VIEWS()[jf.view][1](j) &&
    (!q || join([j.job_name, j.brand_name, j.skills, j.area, j.business_area, j.brand_industry, j.jd], ' ').toLowerCase().includes(q)))
  if (jf.sort === 'pay') list.sort((a, b) => (b.salary_max_k ?? -1) - (a.salary_max_k ?? -1)) // 稳定排序，同薪资仍按发现时间
  if (jf.sort === 'score') list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) // 没分数的排最后
  $('#jobs').innerHTML = `<small>${L(`${list.length} 个`, `${list.length} jobs`)}</small>` + (list.map(jobCard).join('') || `<p><small>${L('没有匹配的岗位', 'No matching jobs')}</small></p>`)
}

const gapCard = (t, g, i) => `<a class="card more gapc ${g.strength || 'none'}" href="#/g/${t.id}/${i}"><b>${icon(g)} ${esc(g.requirement)}</b>
${g.evidence ? `<small>${esc(g.evidence)}</small>` : ''}<div class=probe>${L('追问', 'Follow-up')}: ${esc(g.probe)}</div>${g.study ? `<span class="pill ok">${L('已准备', 'Prepared')}</span>` : ''}${g.failed ? `<span class="pill bad">${L(`模拟没答好 ×${g.failed}`, `Missed in mocks ×${g.failed}`)}</span>` : ''}</a>`

// 先列缺失和薄弱的（要重点准备），有力的折叠起来；链接仍用原始序号
const targetPage = t => {
  const c = tally(t)
  const rows = t.gaps.map((g, i) => ({ g, i }))
  const todo = rows.filter(x => x.g.strength !== 'strong').sort((a, b) => (a.g.strength === 'weak') - (b.g.strength === 'weak'))
  const done = rows.filter(x => x.g.strength === 'strong')
  return `${back('#/', L('面霸', 'Home'))}<h1>${esc(t.company)}<small class=sub>${esc(t.role)}</small></h1>
<div class=meta>${pills(c)}<span>${L(`已准备 ${c.studied}/${t.gaps.length}`, `Prepared ${c.studied}/${t.gaps.length}`)}</span></div>
<a class="btn primary wide" href="#/i/${t.id}">${L('🎤 开始模拟面试', '🎤 Start mock interview')}</a>
<h2>${L('投递进度', 'Application status')} ${stageNow(t) ? `<small>${L('当前', 'Now')}: ${stageNow(t)}</small>` : ''}</h2>
${t.stages?.length ? t.stages.slice().reverse().map(e => `<div class=card><b>${STAGES()[e.s] || esc(e.s)}</b> <small style="display:inline">${new Date(e.at).toLocaleDateString()}</small>${e.note ? `<div>${esc(e.note)}</div>` : ''}</div>`).join('') : `<small>${L('还没记录。先选日期（可选，默认今天）、填备注（可选），再点下面的阶段按钮', 'No entries yet. Pick a date (optional, defaults to today), add a note (optional), then tap a stage button below')}</small>`}
<input type=date id=stgdate onchange="$('#stgnote')?.focus()">
<input id=stgnote placeholder="${esc(L('备注，可选（如 HR 微信、面试官风格）', 'Note, optional (e.g. HR WeChat, interviewer style)'))}">
<div class=chips>${Object.entries(STAGES()).map(([s, n]) => `<button class="chip ${t.stages?.at(-1)?.s === s ? 'on' : ''}" onclick="addStage('${t.id}', '${s}')">${n}</button>`).join('')}</div>
<h2>${L('重点准备', 'Focus prep')} <small>${L('点进去看相关概念、回答思路，和 AI 练追问', 'Open for key concepts, an answer approach, and follow-up practice with AI')}</small></h2>
${todo.map(x => gapCard(t, x.g, x.i)).join('') || `<small>${L('没有薄弱项', 'No weak areas')}</small>`}
${done.length ? `<details class=fold><summary>${L(`✅ 简历能证明的 ${done.length} 条`, `✅ Proven by resume (${done.length})`)}</summary>${done.map(x => gapCard(t, x.g, x.i)).join('')}</details>` : ''}
<h2>${L('领域建模', 'Domain modeling')} <small>${L('面试官爱考「让你设计一个 X」', 'Interviewers love "design an X" questions')}</small></h2>
${(t.domains || []).map((n, i) => { const d = S.domains?.find(x => x.name === n)
  return d ? `<a class="card more" href="#/d/${d.id}"><b>${esc(n)}</b><small>${L('已有知识卡，点进去复习或「考我」', 'Knowledge card exists — open to review or get quizzed')}</small></a>`
    : `<div class=card><b>${esc(n)}</b><button class=btn onclick="genDomainFromTarget('${t.id}', ${i})">${L('生成知识卡', 'Generate knowledge card')}</button></div>` }).join('') || `<small>${L('还没识别这个岗位涉及的领域', 'No domains detected for this role yet')}</small>`}
<button onclick="detectDomains('${t.id}')">${t.domains?.length ? L('重新识别领域', 'Re-detect domains') : L('从 JD 识别领域', 'Detect domains from JD')}</button>
<h2>${L('定制简历', 'Tailored resume')}</h2>
${t.tailored ? `<details><summary>${L('查看定制版', 'View tailored version')}</summary><pre>${esc(t.tailored)}</pre><button onclick="copyTailored('${t.id}')">${L('复制', 'Copy')}</button></details>` : ''}
<button onclick="tailor('${t.id}')">${t.tailored ? L('重新生成', 'Regenerate') : L('按 JD 生成定制简历', 'Generate tailored resume from JD')}</button>
<h2>${L('面经情报', 'Interview intel')}</h2>
${t.intel ? `<div class="card md">${md(t.intel)}</div>` : ''}
<textarea id=intel rows=4 placeholder="${esc(L('粘贴小红书 / 牛客面经原文，可多篇', 'Paste interview-experience posts (Xiaohongshu / Nowcoder), multiple allowed'))}"></textarea>
<button onclick="addIntel('${t.id}')">${L('AI 提炼', 'AI digest')}</button>
<h2>${L('练习记录', 'Mock sessions')}</h2>
${[...t.sessions].reverse().map(s => `<a class="row more" href="#/s/${t.id}/${s.id}">${new Date(s.date).toLocaleString()}<span class=stars>${'★'.repeat(s.rating)}</span></a>`).join('') || `<small>${L('暂无，点上面「开始模拟面试」', 'None yet — tap "Start mock interview" above')}</small>`}
<div class=footer><button class=danger onclick="delTarget('${t.id}')">${L('删除这个岗位', 'Delete this target role')}</button></div>`
}

const ASKS = () => [L('给我一个参考回答', 'Give me a reference answer'), L('面试官接下来还会怎么追问？', 'How will the interviewer follow up next?'), L('我先答一遍，你来点评', "I'll answer first — critique me")]
const gapPage = (t, i) => {
  const g = t.gaps[i]
  if (!g) return targetPage(t)
  const st = g.study
  return `${back('#/t/' + t.id, t.company)}<h1 class=req>${icon(g)} ${esc(g.requirement)}</h1>
<div class="card gapc ${g.strength || 'none'}"><small>${L('简历证据', 'Resume evidence')}</small><div>${esc(g.evidence || L('简历里没找到能证明这一条的经历', 'No resume evidence found for this requirement'))}</div>
<small class=lbl>${L('面试官追问', 'Interviewer follow-up')}</small><div><b>${esc(g.probe)}</b></div></div>
<h2>${L('相关概念', 'Key concepts')} <small>${L('点一个让 AI 展开讲', 'Tap one for a deep dive from AI')}</small></h2>
${st ? `<div class=concepts>${st.concepts.map((c, k) => `<a class="card more" href="javascript:askConcept(${k})"><b>${esc(c.name)}</b><div class=clamp>${mdInline(txt(c.explain))}</div></a>`).join('')}</div>` : `<small>${L('生成中…', 'Generating…')}</small>`}
<h2>${L('回答思路', 'Answer approach')} ${st ? `<button class=link onclick="genStudy(true)">${L('重新生成', 'Regenerate')}</button>` : ''}</h2>
${st ? `<div class="card md">${md(txt(st.approach))}</div>` : `<small>${L('生成中…', 'Generating…')}</small>`}
<h2>${L('问 AI', 'Ask AI')} ${g.chat?.length ? `<button class="link danger" onclick="clearGapChat()">${L('清空对话', 'Clear chat')}</button>` : ''}</h2>
<div id=chat>${(g.chat || []).map((m, i) => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg assistant md">${md(m.content)}${transHTML(m, `trGapMsg(this, ${i})`)}</div>`).join('') || `<small>${L('点上面的概念，或用下面的快捷提问开始', 'Tap a concept above, or use a quick prompt below')}</small>`}</div>
<div class=composer>
<div class=chips>${ASKS().map((q, k) => `<button class=chip onclick="askPreset(${k})">${esc(q)}</button>`).join('')}</div>
<div class=bar><textarea id=answer rows=1 placeholder="${esc(L('问 AI，或写下你的回答让它点评', 'Ask AI, or write your answer for critique'))}" oninput="grow(this)"></textarea><button class=primary onclick="askGap()">${L('发送', 'Send')}</button></div>
${(g.study || g.chat?.length) ? assess(`g:${t.id}:${i}`) : ''}
</div>`
}

const interviewPage = t => `${back('#/t/' + t.id)}<h1>${esc(title(t))}</h1>
<div id=chat></div>
<div id=controls class=composer>
  <textarea id=answer rows=2 placeholder="${esc(L('语音或打字回答', 'Speak or type your answer'))}" oninput="grow(this)"></textarea>
  <button id=mic class=primary onclick="toggleMic()">${L('🎙 语音回答', '🎙 Speak')}</button>
  <button onclick="sendAnswer()">${L('发送', 'Send')}</button>
  <button onclick="endInterview()">${L('结束面试', 'End interview')}</button>
</div>
<div id=review></div>`

const sessionPage = (t, sid) => {
  const s = t.sessions.find(s => s.id === sid)
  if (!s) return targetPage(t)
  return `${back('#/t/' + t.id)}<h1>${L('复盘', 'Debrief')} · ${new Date(s.date).toLocaleString()}</h1>${reviewHTML(s.review)}
<h2>${L('面试记录', 'Interview transcript')}</h2>${s.messages.map((m, i) => `<div class="msg ${m.role === 'assistant' ? 'assistant md' : m.role}">${m.role === 'assistant' ? md(m.content) + transHTML(m, `trSessionMsg(this, '${t.id}', '${s.id}', ${i})`) : esc(m.content)}</div>`).join('')}`
}

function route() {
  if (!ready) return
  stopVoice()
  hideSheet?.()
  const [, page = '', id, sub] = location.hash.split('/')
  const t = id && target(id)
  $('#app').innerHTML =
    page === 'resume' ? resumePage()
    : page === 'jobs' ? jobsPage()
    : page === 'market' ? marketPage()
    : page === 'projects' ? projectsPage()
    : page === 'p' ? projectPage(id)
    : page === 'me' ? mePage()
    : page === 'notes' ? notesPage()
    : page === 'nr' ? noteReviewPage(id)
    : page === 'history' ? historyPage()
    : page === 'practice' ? practicePage()
    : page === 'ds' ? sectionPage(id, +sub)
    : page === 'domains' ? domainsPage()
    : page === 'd' ? domainPage(id, sub != null && /^\d+$/.test(sub) ? +sub : null)
    : page === 'new' && S.resume ? newPage(id && J && J.find(j => j.id === decodeURIComponent(id)))
    : !t ? home()
    : page === 't' ? targetPage(t)
    : page === 'i' ? interviewPage(t)
    : page === 's' ? sessionPage(t, sub)
    : page === 'g' ? gapPage(t, +sub)
    : home()
  if (page === 'i' && t) startInterview(t)
  if (page === 'g' && t?.gaps[+sub] && !t.gaps[+sub].study) genStudy()
  if (page === 'jobs') renderJobs()
  // 底部 tab：按路由高亮；模拟面试页全屏沉浸
  // 课程页首次进入自动生成大纲（页面里有手动按钮兜底）
  if (page === 'd' && id && domOf(id) && !domOf(id).outline && !busy) genOutline(id)
  if (page === 'ds' && id && domOf(id)?.outline?.[+sub] && !domOf(id).sections?.[+sub] && !busy) genSection(id, +sub)
  if (page === 'd' && id && sub != null && /^\d+$/.test(sub)) {
    const d0 = domOf(id), q0 = (d0?.quiz || '').split('\n').filter(Boolean)[+sub]
    if (d0 && q0 && !(d0.chat || []).length) askDrill(id, q0)
  }
  const tab = /^#\/(jobs|market)/.test(location.hash) ? 'jobs'
    : /^#\/(practice|domains|d\/)/.test(location.hash) ? 'practice'
    : /^#\/(me|resume|projects|p\/)/.test(location.hash) ? 'me' : 'home'
  document.body.classList.toggle('notabs', /^#\/i\//.test(location.hash))
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.t === tab))
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
    if (!text) throw new Error(L('PDF 里没抽到文字（可能是扫描件），直接粘贴文字吧', 'No text extracted from this PDF (probably a scan) — paste the text directly instead'))
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
  if (!company || !role || !jd) return alert(L('公司、岗位、JD 都要填', 'Company, role and JD are all required'))
  const [, page, jobId] = location.hash.split('/') // 从岗位雷达建的，记下来源岗位
  withBusy(async () => {
    const t = { id: crypto.randomUUID(), company, role, jd, gaps: [], tailored: '', intel: '', sessions: [],
      ...(page === 'new' && jobId && { jobId: decodeURIComponent(jobId) }) }
    const r = await askJSON(P.gaps, P.material(t))
    t.gaps = r.gaps
    t.domains = String(txt(r.domains) || '').split('\n').map(x => x.trim().replace(/^[-•\d.、]+\s*/, '')).filter(Boolean).slice(0, 6)
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
  if (!raw) return alert(L('先粘贴面经原文', 'Paste the interview-experience text first'))
  withBusy(async () => {
    const t = target(id)
    const summary = await chat(P.intel(t), [{ role: 'user', content: raw }])
    t.intel = t.intel ? t.intel + '\n\n' + summary : summary
    await save()
    route()
  })
}

const copyTailored = id => navigator.clipboard.writeText(target(id).tailored).then(() => alert(L('已复制', 'Copied')))

function delTarget(id) {
  if (!confirm(L('删除这个岗位和它的所有练习记录？', 'Delete this target role and all its mock sessions?'))) return
  withBusy(async () => {
    S.targets = S.targets.filter(t => t.id !== id)
    await save()
    location.hash = '#/'
  })
}

// 追加一条投递进度；日期框留空就记今天，备注可选
const addStage = (tid, s) => withBusy(async () => {
  const t = target(tid)
  const d = $('#stgdate')?.value
  const note = $('#stgnote')?.value.trim()
  t.stages ??= []
  t.stages.push({ s, at: (d || new Date().toISOString().slice(0, 10)) + 'T' + new Date().toISOString().slice(11, 19), ...(note && { note }) })
  await save()
  route()
})

// ---------- 练习引擎：掌握度 + 间隔重复 ----------
// 条目 key：g:<岗位id>:<序号>（差距追问）｜dq:<领域id>:<题号>（建模题）
// m：0 还不会（明天复习）｜1 模糊（3 天后）｜2 掌握（14 天后）
const yesterday = () => new Date(Date.now() - 86400e3).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)

const resolveKey = k => {
  const [, type, a, b] = k.split(':')
  if (type === 'g') { const t = target(a), g = t?.gaps[+b]
    return g ? { label: g.requirement, sub: `${t.company} · ${L('追问', 'follow-up')}`, href: `#/g/${a}/${b}` } : null }
  if (type === 'dq') { const d = domOf(a), q = (d?.quiz || '').split('\n').filter(Boolean)[+b]
    return d && q ? { label: q, sub: `${d.name} · ${L('建模题', 'design question')}`, href: `#/d/${a}/${b}` } : null }
  if (type === 'n') { const n = (S.notes || []).find(x => x.id === a)
    return n ? { label: n.term, sub: L('概念笔记', 'Concept note'), href: `#/nr/${a}` } : null }
  if (type === 'ds') { const d = domOf(a), t = d?.outline?.[+b]
    return d && t ? { label: t.t, sub: `${d.name} · ${L('课程', 'course')}`, href: `#/ds/${a}/${b}` } : null }
  return null
}
const dueItems = () => Object.entries(S.practice?.items || {})
  .filter(([k, v]) => v.due && v.due <= today())
  .map(([k, v]) => ({ ...resolveKey(k), key: k, m: v.m, due: v.due }))
  .filter(x => x.label)
  .sort((a, b) => a.m - b.m || (a.due < b.due ? -1 : 1))
// 错题：模拟面试没答好的差距 + 自评为「还不会」的条目
const wrongItems = () => {
  const out = []
  for (const t of S.targets || []) t.gaps.forEach((g, i) => {
    const key = `g:${t.id}:${i}`
    if (g.failed > 0 || S.practice?.items[key]?.m === 0)
      out.push({ label: g.requirement, sub: `${t.company}${g.failed ? ` · ${L(`面试没答好 ×${g.failed}`, `missed ×${g.failed}`)}` : ''}`, href: `#/g/${t.id}/${i}` })
  })
  for (const d of S.domains || []) (d.quiz || '').split('\n').filter(Boolean).forEach((q, qi) => {
    if (S.practice?.items[`dq:${d.id}:${qi}`]?.m === 0)
      out.push({ label: q, sub: `${d.name} · ${L('建模题', 'design question')}`, href: `#/d/${d.id}/${qi}` })
  })
  for (const n of S.notes || []) if (S.practice?.items[`n:${n.id}`]?.m === 0)
    out.push({ label: n.term, sub: L('概念笔记', 'Concept note'), href: `#/nr/${n.id}` })
  return out
}
const weekDone = () => [...Array(7)].reduce((a, _, i) => a + (S.practice?.log?.[new Date(Date.now() - i * 86400e3).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)] || 0), 0)

function recordPractice(key, m) {
  withBusy(async () => {
    S.practice ??= { items: {}, log: {}, streak: 0, lastDay: '' }
    const P = S.practice
    P.items ??= {}; P.log ??= {}
    const it = P.items[key] ??= { m: 1, seen: 0 }
    it.m = m; it.seen++; it.last = new Date().toISOString()
    it.due = new Date(Date.now() + [1, 3, 14][m] * 86400e3).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
    const td = today()
    if (P.lastDay !== td) { P.streak = P.lastDay === yesterday() ? (P.streak || 0) + 1 : 1; P.lastDay = td }
    P.log[td] = (P.log[td] || 0) + 1
    await save()
    route()
  })
}
const assess = key => `<div class=assess>${L('练完自评：', 'Self-rate:')}
<button class="chip" onclick="recordPractice('${key}',0)">${L('还不会', "Don't know it")}</button>
<button class="chip" onclick="recordPractice('${key}',1)">${L('有点模糊', 'Fuzzy')}</button>
<button class="chip on" onclick="recordPractice('${key}',2)">${L('掌握了', 'Got it')}</button></div>`

// ---------- 概念笔记本 ----------
const noteOf = id => (S.notes || []).find(x => x.id === id)
const unmasteredNotes = () => (S.notes || []).filter(n => S.practice?.items[`n:${n.id}`]?.m !== 2)

const notesPage = () => {
  const ns = S.notes || []
  const nm = S.practice?.items ? Object.keys(S.practice.items).filter(k => k.startsWith('n:') && S.practice.items[k].m === 2).length : 0
  return `<h1>${L('笔记本', 'Notes')} <small>${L(`${ns.length} 条 · 已掌握 ${nm}`, `${ns.length} notes · ${nm} mastered`)}</small></h1>
${ns.length ? `<a class="btn primary wide" href="#/nr/${unmasteredNotes()[0]?.id || ns[0].id}">${L(`🃏 开始复习（剩 ${unmasteredNotes().length} 条）`, `🃏 Start review (${unmasteredNotes().length} left)`)}</a>` : `<small>${L('阅读课程或 AI 回答时，选中文字即可「讲解」或「记笔记」', 'While reading a course or AI answer, select text to "Explain" or "Save note"')}</small>`}
${[...ns].reverse().map(n => `<div class="card">
<b>${esc(n.term)}</b> <small style="display:inline">${esc(n.src || '')}</small>
${n.note ? `<div class=md>${md(n.note)}</div>` : ''}
<details><summary>${L('讲解', 'Explanation')}</summary><div class=md>${md(n.explain || L('（还没生成讲解）', '(no explanation generated yet)'))}</div></details>
<details><summary>${L('批注', 'My annotation')}</summary><textarea id="nte-${n.id}" rows=3 placeholder="${esc(L('自己的话，写一遍记得更牢', 'In your own words — writing it once makes it stick'))}">${esc(n.note || '')}</textarea><button class="btn" onclick="saveNoteNote('${n.id}')">${L('保存批注', 'Save annotation')}</button></details>
<div class=chips><button class="chip" onclick="location.hash='#/nr/${n.id}'">${L('复习这条', 'Review this')}</button><button class="chip" onclick="delNote('${n.id}')">${L('删除', 'Delete')}</button></div>
</div>`).join('')}`
}

const noteReviewPage = id => {
  const n = noteOf(id)
  if (!n) return notesPage()
  const rest = unmasteredNotes()
  const next = rest.find(x => x.id !== id) || rest[0]
  return `${back('#/notes', L('笔记本', 'Notes'))}<h1>${L('🃏 概念闪卡', '🃏 Concept flashcards')}</h1>
<div class="card"><b style="font-size:20px">${esc(n.term)}</b><small>${esc(n.src || '')}</small></div>
<details><summary style="font-size:16px">${L('👆 心里过一遍，点这里看答案', '👆 Recall it mentally, then tap to reveal')}</summary><div class="card md">${md(n.explain || L('（这条笔记没有讲解，点下面生成）', '(no explanation for this note yet — generate below)'))}</div></details>
<div class=chips><button class="chip" onclick="genNoteExplain('${id}')">${L('生成讲解', 'Generate explanation')}</button>${next && next.id !== id ? `<button class="chip" onclick="location.hash='#/nr/${next.id}'">${L('下一张 →', 'Next →')}</button>` : ''}</div>
${assess(`n:${id}`)}
`
}

const genNoteExplain = id => withBusy(async () => {
  const n = noteOf(id)
  n.explain = await chat('你是资深架构师和面试辅导。用 2-4 句话通俗讲解给出的概念，最后单独一行「面试视角：」给一句要点。简洁，中文。',
    [{ role: 'user', content: `${L('概念', 'Concept')}: ${n.term}\n${L('来源', 'Source')}: ${n.src || ''}${projectsBlock()}` }])
  await save()
  route()
})

const saveNoteNote = id => withBusy(async () => {
  noteOf(id).note = $(`#nte-${id}`).value.trim()
  await save()
  route()
})
function delNote(id) {
  if (!confirm(L('删除这条笔记？', 'Delete this note?'))) return
  withBusy(async () => {
    S.notes = (S.notes || []).filter(x => x.id !== id)
    delete S.practice?.items[`n:${id}`]
    await save()
    location.hash = '#/notes'
  })
}

// ---------- 讲解历史：划词「讲解」每次生成的内容都自动记档 ----------
const historyPage = () => {
  const es = [...(S.explains || [])].reverse() // 新的排前面
  return `${back('#/me', L('我的', 'Me'))}<h1>${L('讲解历史', 'Explanation history')} <small>${L(`${es.length} 条`, `${es.length} records`)}</small></h1>
${es.map(e => `<div class="card"><b>${esc(e.term)}</b> <small style="display:inline">${esc(e.src || '')} · ${new Date(e.at).toLocaleString()}</small>
<div class=md>${md(e.explain || '')}</div>
${transHTML(e, `trExplain(this, '${e.id}')`)}
<div class=chips><button class="chip on" onclick="noteTerm(${esc(JSON.stringify(e.term))}, ${esc(JSON.stringify(e.explain || ''))}, ${esc(JSON.stringify(e.src || ''))})">${L('📒 记到笔记', '📒 Save to notes')}</button></div></div>`).join('') || `<small>${L('还没有讲解记录。阅读课程或 AI 回答时划词点「讲解」，每次都会记到这里', 'No explanations yet. Select text while reading and tap "Explain" — every one is logged here')}</small>`}
${es.length ? `<div class=footer><button class=danger onclick="clearExplains()">${L('清空讲解历史', 'Clear explanation history')}</button></div>` : ''}`
}

function clearExplains() {
  if (!confirm(L('清空全部讲解历史？', 'Clear the entire explanation history?'))) return
  withBusy(async () => { S.explains = []; await save(); route() })
}

// 练习主页：今日任务 + 错题本 + 领域卡
const practicePage = () => {
  const due = dueItems(), wrong = wrongItems()
  const P = S.practice || {}
  return `<h1>${L('练习', 'Practice')}</h1>
<div class="tiles sm">
  <div class="card tile"><small>${L('待复习', 'Due')}</small><b class="${due.length ? 'hot' : ''}">${due.length}</b></div>
  <div class="card tile"><small>${L('错题', 'Mistakes')}</small><b class="${wrong.length ? 'hot' : ''}">${wrong.length}</b></div>
  <div class="card tile"><small>${L('今日已练', 'Done today')}</small><b>${P.log?.[today()] || 0}</b></div>
  <div class="card tile"><small>${L('连续', 'Streak')}</small><b>${P.streak || 0}<i>${L('天', 'd')}</i></b></div>
</div>
<h2>${L('今日待复习', 'Due today')} <small>${L('到期的知识点，不会的排前面', 'Due items, weakest first')}</small></h2>
${due.slice(0, 12).map(x => `<a class="row more" href="${x.href}"><b>${x.m === 0 ? '❌' : x.m === 1 ? '⚠️' : '✅'} ${esc(x.label)}</b><small>${esc(x.sub)}</small></a>`).join('') || `<small>${L('今天没有到期的复习，练下面的领域卡或等每日一题', 'Nothing due today — practice a domain card below or wait for the daily question')}</small>`}
<h2>${L('错题本', 'Mistakes')} <small>${L('面试没答好的和自评「还不会」的', 'Missed in mocks, or self-rated "not yet"')}</small></h2>
${wrong.slice(0, 12).map(x => `<a class="row more" href="${x.href}"><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></a>`).join('') || `<small>${L('还没有错题，保持', 'No mistakes — keep it up')}</small>`}
<h2>${L('领域卡', 'Domain cards')} <small>${L(`本周共练 ${weekDone()} 次 · 概念笔记 ${S.notes?.length || 0} 条`, `${weekDone()} reps this week · ${S.notes?.length || 0} notes`)}</small></h2>
${(S.domains || []).map(d => { const ol = d.outline || []
  const m = ol.filter((_, i) => S.practice?.items[`ds:${d.id}:${i}`]?.m === 2).length
  const qn = (d.quiz || '').split('\n').filter(Boolean).length
  return `<a class="row more" href="#/d/${d.id}"><b>${esc(d.name)}</b><small>${ol.length ? L(`课程 ${m}/${ol.length} 节 · `, `Course ${m}/${ol.length} · `) : ''}${L(`${qn} 道建模题`, `${qn} design questions`)}</small></a>` }).join('') || `<small>${L('还没有领域卡，到目标岗位页「从 JD 识别领域」后生成', "No domain cards yet — generate from a target role's JD")}</small>`}
<a class="btn primary wide" href="#/d/new">${L('＋ 添加领域', '+ Add domain')}</a>`
}

// ---------- 领域建模 ----------
const domOf = id => S.domains?.find(x => x.id === id)
// 知识卡的「面试常见建模题」段抽出来当题库（到下一个 ## 为止，避免混入通用陷阱）；英文写法兼容旧数据（AI 输出跟随界面语言时期生成的标题）
const quizOf = facts => { const seg = String(facts).split(/面试常见建模题|[Mm]odeling [Qq]uestion/)[1]?.split('##')[0] || ''
  return seg.split('\n').map(x => x.trim()).filter(x => x.startsWith('- ')).map(x => x.slice(2)).join('\n') }

function detectDomains(tid) {
  withBusy(async () => {
    const t = target(tid)
    const r = await chat('从下面的 JD 提取 3-6 个业务领域名（如：支付结算、订单履约、身份权限、库存调度、风控、数据同步、营销优惠）。每行一个，只写领域名，不要编号和解释。', [{ role: 'user', content: t.jd }])
    t.domains = r.split('\n').map(x => x.trim().replace(/^[-•\d.、]+\s*/, '')).filter(Boolean).slice(0, 6)
    await save()
    route()
  })
}

// withBusy 不能嵌套（内层会被 busy 守卫静默吞掉），生成走不带守卫的 genDomainCardInner
const genDomainCardInner = async (id) => {
  const d = domOf(id)
  d.facts = await chat(P.domainGen, [{ role: 'user', content: `领域：${d.name}${projectsBlock()}` }])
  d.quiz = quizOf(d.facts)
  await save()
}

const genDomainCard = id => withBusy(() => genDomainCardInner(id))

const genDomainFromTarget = (tid, i) => withBusy(async () => {
  const t = target(tid)
  S.domains ??= []
  const d = { id: crypto.randomUUID(), name: t.domains[i], facts: '', quiz: '', chat: [] }
  S.domains.push(d)
  await save()
  await genDomainCardInner(d.id)
  location.hash = '#/d/' + d.id
})

const addDomain = () => withBusy(async () => {
  const name = $('#dname').value.trim()
  if (!name) return alert(L('领域名要填', 'Domain name is required'))
  S.domains ??= []
  const facts = $('#dfacts').value.trim()
  S.domains.push({ id: crypto.randomUUID(), name, facts, quiz: quizOf(facts), chat: [] })
  await save()
  location.hash = '#/domains'
})

const saveDomainFacts = id => withBusy(async () => {
  const d = domOf(id)
  d.facts = $('#dfacts').value.trim()
  d.quiz = quizOf(d.facts)
  await save()
  route()
})

// ---------- 领域课程 ----------
const genOutline = id => withBusy(async () => {
  const d = domOf(id)
  const r = await askJSON(P.outlineGen, `领域：${d.name}${projectsBlock()}`)
  if (!Array.isArray(r.sections) || !r.sections.length) throw new Error(L('大纲格式不对，再试一次', 'Unexpected outline format, try again'))
  d.outline = r.sections.map(x => ({ t: String(x.t).slice(0, 40) }))
  await save()
  route()
})

const genSection = (id, i) => withBusy(async () => {
  const d = domOf(id)
  const titles = d.outline.map((x, k) => `${k + 1}. ${x.t}`).join('\n')
  const content = await chat(P.sectionGen, [{ role: 'user', content: `领域：${d.name}\n\n课程大纲（当前要写第 ${i + 1} 节）：\n${titles}\n\n要写的节：${d.outline[i].t}${projectsBlock()}` }])
  d.sections ??= {}
  d.sections[i] = { content, at: new Date().toISOString() }
  await save()
  route()
})

function drillSection(id, i) {
  const d = domOf(id), sec = d.sections?.[i]
  if (!sec) return
  location.hash = '#/d/' + id
  askDrill(id, L(`就下面这节课程的内容出题考我：先出一道相关的题（设计或概念辨析），我答完后追问 2-3 层再点评。\n\n<本节内容>\n${sec.content}\n</本节内容>`, `Quiz me on this course section: pose one related question (design or concept discrimination), follow up 2-3 layers after I answer, then critique.\n\n<section>\n${sec.content}\n</section>`))
}

function askDrillSend(id) {
  const text = $('#answer').value.trim()
  if (!text || busy) return
  askDrill(id, text)
}
function askDrill(id, text) {
  withBusy(async () => {
    const d = domOf(id)
    const messages = [...(d.chat || []), { role: 'user', content: text }]
    const reply = await chat(P.drill(d), messages)
    domOf(id).chat = [...messages, { role: 'assistant', content: reply }]
    await save()
    route()
    $('#chat').lastElementChild?.previousElementSibling?.scrollIntoView({ block: 'start' })
  })
}
function clearDrill(id) {
  if (!confirm(L('清空这个领域的对话？', 'Clear the chat for this domain?'))) return
  withBusy(async () => { domOf(id).chat = []; await save(); route() })
}

// 再点一次同一个标记就取消；标完只重画列表，当前位置不跳
async function markJob(id, s) {
  S.jobMarks ??= {}
  if (S.jobMarks[id]?.s === s) delete S.jobMarks[id]
  else S.jobMarks[id] = { s, at: new Date().toISOString() }
  const y = scrollY
  route()
  scrollTo(0, y)
  try { await save() } catch (e) { alert(L('保存失败：', 'Save failed: ') + e.message) }
}

// ---------- 行情：岗位库统计（单色横条，标签用文字色） ----------
const topN = (d, n) => (Array.isArray(d) ? d : Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])).sort((a, b) => b[1] - a[1]).slice(0, n)
const count = a => a.reduce((g, x) => (g[x] = (g[x] || 0) + 1, g), {})
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const tiles = a => `<div class=tiles>${a.map(([k, v]) => `<div class="card tile"><small>${k}</small><b>${v}</b></div>`).join('')}</div>`
const bars = (rows, unit = '') => { const max = Math.max(...rows.map(r => r[1]), 1)
  return rows.map(([k, v]) => `<div class=mrow><span class=mlbl title="${esc(k)}">${esc(k)}</span><span class=mtrack><span class=mfill style="width:${Math.max(2, Math.round(v / max * 100))}%"></span></span><span class=mval>${v}${unit}</span></div>`).join('') }
const group = (m, key, val) => { const g = {}; for (const j of m) { const k = key(j) || L('其他', 'Other'); (g[k] ??= []).push(val(j)) } return g }

const marketPage = () => {
  if (J === null || J === false) return `${back('#/jobs', L('岗位', 'Jobs'))}<h1>${L('行情', 'Market')}</h1>${J === null ? loading() : `<small>${L('没有岗位数据', 'No job data')}</small>`}`
  const m = J.filter(j => j.matched)
  if (!m.length) return `${back('#/')}<h1>${L('行情', 'Market')}</h1><small>${L('还没有符合条件的岗位', 'No matching jobs yet')}</small>`
  const pay = m.map(j => j.salary_max_k).filter(v => v != null)
  const nm = m.length - pay.length
  const bonus = m.map(j => (j.salary_desc || '').match(/·(\d+)薪/)?.[1]).filter(Boolean)
  const bonusMode = topN(count(bonus), 1)[0]?.[0]
  const expG = group(m, j => j.experience, j => j.salary_max_k)
  const expRows = Object.entries(expG).map(([k, v]) => [k, v.length, med(v.filter(x => x != null))]).sort((a, b) => b[1] - a[1])
  const skillG = group(m.flatMap(j => (j.skills || '').split(',').filter(Boolean).map(s => [s, j])), x => x[0], x => 1)
  const skillRows = topN(Object.entries(skillG).map(([k, v]) => [k, v.length]), 15).map(([k, n]) => [k, n])
  const areaRows = topN(Object.entries(group(m, j => [j.area, j.business_area].filter(Boolean).join('·'), () => 1)).map(([k, v]) => [k, v.length]), 8)
  return `${back('#/jobs', L('岗位', 'Jobs'))}<h1>${L('行情', 'Market')} <small>${L(`符合条件 ${m.length} 个岗位`, `${m.length} matching jobs`)}</small></h1>
${tiles([[L('薪资上限中位数', 'Median top salary'), med(pay) ? med(pay) + 'K' : '—'], [L('前 25%', 'Top 25%'), (pct(pay, .75) ?? '—') + (pct(pay, .75) ? 'K' : '')], [L('面议', 'Negotiable'), nm ? L(`${nm} 个`, `${nm} jobs`) : L('无', 'None')], [L('常见年终', 'Typical bonus'), bonusMode ? L(`·${bonusMode}薪`, `·${bonusMode} months`) : '—']])}
<h2>${L('薪资上限分布', 'Top-salary distribution')}</h2>
${bars([['40-50K', pay.filter(v => v < 50).length], ['50-60K', pay.filter(v => v >= 50 && v < 60).length], ['60-70K', pay.filter(v => v >= 60 && v < 70).length], ['70-80K', pay.filter(v => v >= 70 && v < 80).length], ['80K+', pay.filter(v => v >= 80).length]], L(' 个', ' jobs'))}
<h2>${L('经验要求', 'Experience required')} <small>${L('条后是薪资上限中位数', 'count followed by median top salary')}</small></h2>
${expRows.map(([k, n, md]) => `<div class=mrow><span class=mlbl>${esc(k)}</span><span class=mtrack><span class=mfill style="width:${Math.max(2, Math.round(n / expRows[0][1] * 100))}%"></span></span><span class=mval>${L(`${n} 个`, `${n} jobs`)}${md ? ' · ' + md + 'K' : ''}</span></div>`).join('')}
<h2>${L('技能要求 TOP15', 'Top 15 skills')} <small>${L('占符合条件岗位比例', 'share of matching jobs')}</small></h2>
${bars(skillRows.map(([k, n]) => [k, Math.round(n / m.length * 100) + '%']), '')}
<h2>${L('区域分布', 'Areas')}</h2>
${bars(areaRows, L(' 个', ' jobs'))}
<h2>${L('公司规模', 'Company size')}</h2>
${bars(topN(Object.entries(group(m, j => j.brand_scale, () => 1)).map(([k, v]) => [k, v.length]), 6), L(' 个', ' jobs'))}`
}

// ---------- 差距详情：概念讲解 + 回答思路 + 追问 ----------
// 当前打开的是哪条：每次都从 S 里现取，切回前台重新 load 后也不会写到旧对象上
const curGap = () => { const [, , tid, i] = location.hash.split('/'); return { t: target(tid), g: gapOf(tid, +i) } }

const genStudy = (force = false) => withBusy(async () => {
  const { t, g } = curGap()
  if (!g || (g.study && !force)) return
  const r = await askJSON(P.study, `${P.material(t)}\n\n<要求>${g.requirement}</要求>\n<简历证据>${g.evidence || '无'}</简历证据>\n<追问>${g.probe}</追问>`)
  const fresh = curGap().g
  if (!fresh || !Array.isArray(r.concepts)) throw new Error(L('AI 返回格式不对，再试一次', 'AI returned an unexpected format, try again'))
  fresh.study = { concepts: r.concepts, approach: r.approach }
  await save()
  route()
})

function askGap(text = $('#answer').value.trim()) {
  if (!text || busy) return
  withBusy(async () => {
    const { t, g } = curGap()
    const messages = [...(g.chat || []), { role: 'user', content: text }]
    const reply = await chat(P.tutor(t, g), messages)
    const fresh = curGap().g
    fresh.chat = [...messages, { role: 'assistant', content: reply }]
    await save()
    route()
    $('#chat').lastElementChild?.previousElementSibling?.scrollIntoView({ block: 'start' })
  })
}
const grow = el => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px' }
const askConcept = k => askGap(L(`详细讲讲「${curGap().g.study.concepts[k].name}」：原理、和这道追问的关系、面试官常见的深挖点。`, `Explain "${curGap().g.study.concepts[k].name}" in depth: how it works, how it relates to this follow-up, and where interviewers typically dig deeper.`))
const askPreset = k => k === 2 ? $('#answer').focus() : askGap(ASKS()[k])

function clearGapChat() {
  if (!confirm(L('清空这一条的对话记录？', 'Clear the chat for this requirement?'))) return
  withBusy(async () => {
    curGap().g.chat = []
    await save()
    route()
  })
}

// ---------- 模拟面试 ----------
let iv = null // { t, messages, review }

function startInterview(t) {
  const g = P.greeting()
  iv = { t, messages: [{ role: 'assistant', content: g }] }
  renderChat()
  speak(g)
}

function renderChat() {
  $('#chat').innerHTML = iv.messages.map((m, i) =>
    `<div class="msg ${m.role === 'assistant' ? 'assistant md' : m.role}" ${m.role === 'assistant' ? `onclick="speak(iv.messages[${i}].content)"` : ''}>${m.role === 'assistant' ? md(m.content) + transHTML(m, `trIvMsg(this, ${i})`) : esc(m.content)}</div>`).join('')
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
  if (iv.messages.length < 3) return alert(L('至少答一轮再结束', 'Answer at least one round before ending'))
  stopVoice()
  withBusy(async () => {
    const transcript = iv.messages.map(m => (m.role === 'user' ? L('候选人', 'Candidate') : L('面试官', 'Interviewer')) + L('：', ': ') + m.content).join('\n')
    iv.review = await askJSON(P.review(iv.t), transcript)
    $('#controls').hidden = true
    $('#review').innerHTML = `<h2>${L('复盘', 'Debrief')}</h2>${reviewHTML(iv.review, true)}
<p>${L('自评这一轮后保存：', 'Rate this round to save:')}</p>${[1, 2, 3, 4, 5].map(n => `<button onclick="saveSession(${n})">${'★'.repeat(n)}</button>`).join('')}
<button class=danger onclick="location.hash='#/t/${iv.t.id}'">${L('丢弃', 'Discard')}</button>`
    $('#review').scrollIntoView()
  })
}

const saveSession = rating => withBusy(async () => {
  // 没答好的条目记一笔：g.failed 次数 + 最近时间，岗位页上会标「模拟没答好」，提示去重练
  const missed = String(txt(iv.review?.missed) || '').split('\n').map(x => x.trim()).filter(Boolean)
  for (const name of missed) {
    const g = iv.t.gaps.find(g => g.requirement === name)
    if (g) { g.failed = (g.failed || 0) + 1; g.failedAt = new Date().toISOString() }
  }
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
  u.lang = voiceLang()
  speechSynthesis.speak(u)
}

function toggleMic() {
  if (rec) { rec.sendOnEnd = true; return rec.stop() } // 等最后一段结果到了再在 onend 里发送
  if (!SR) return alert(L('这个浏览器不支持语音识别，换 Safari / Chrome，或者直接打字', 'This browser does not support speech recognition — use Safari/Chrome, or just type'))
  speechSynthesis.cancel()
  const r = rec = new SR()
  r.lang = voiceLang()
  r.continuous = true
  r.interimResults = true
  const before = $('#answer').value
  r.onresult = e => { $('#answer').value = before + [...e.results].map(x => x[0].transcript).join('') }
  r.onerror = e => { if (!['aborted', 'no-speech'].includes(e.error)) alert(L('语音识别出错：', 'Speech recognition error: ') + e.error) }
  r.onend = () => {
    rec = null
    if ($('#mic')) $('#mic').textContent = L('🎙 语音回答', '🎙 Speak')
    if (r.sendOnEnd) sendAnswer()
  }
  r.start()
  $('#mic').textContent = L('⏹ 说完了', '⏹ Done')
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
// 先用缓存秒开，再拉最新覆盖（正填着表单就不动页面，切回来再刷新）
{
  const c = cache.read()?.d
  if (c?.state) { S = c.state; if (c.jobs) J = c.jobs; ready = true; route() }
}
load().then(() => {
  ready = true
  const editing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')
  if (!editing) route()
}).catch(e => {
  $('#app').innerHTML = `<div class=loading><span class=spin></span><small>${L('连不上服务器：', 'Cannot reach server: ')}${esc(e.message)}</small><button class=btn onclick="location.reload()">${L('重试', 'Retry')}</button></div>`
})
// 岗位数据单独拉，慢了也不挡首页
loadJobs().then(() => { if (onHome() || /^#\/(jobs|new\/|market)/.test(location.hash)) route() })
