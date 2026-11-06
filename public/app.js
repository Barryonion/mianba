// 面霸前端：原生 JS，hash 路由，整份状态存服务端。
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const txt = v => Array.isArray(v) ? v.join('\n') : v // AI 偶尔把字符串字段返回成数组

let S = { resume: '', targets: [] }
let busy = false
let J = null // 岗位雷达：null 加载中，false 服务器没接巡检数据
const jf = { view: 'todo', sort: 'new', q: '' }

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
  greeting: '你好，我是今天的面试官。先做个简单的自我介绍吧，重点讲讲和这个岗位相关的经历。',
}

// ---------- 页面 ----------
// 顶部吸顶返回栏，滚动长页面时随时能回去
const back = (href, label = '返回') => `<div class=top><a href="${href}">‹ ${esc(label)}</a></div>`
// 差距分析计数：✅ 有力 ⚠️ 薄弱 ❌ 缺失，外加已准备（生成过概念讲解）的条数
const tally = t => ({ strong: t.gaps.filter(g => g.strength === 'strong').length, weak: t.gaps.filter(g => g.strength === 'weak').length,
  none: t.gaps.filter(g => !['strong', 'weak'].includes(g.strength)).length, studied: t.gaps.filter(g => g.study).length })
const pills = c => `<span class="pill bad">❌ ${c.none}</span><span class="pill warn">⚠️ ${c.weak}</span><span class="pill ok">✅ ${c.strong}</span>`
const icon = g => ({ strong: '✅', weak: '⚠️' })[g.strength] || '❌'
// 极简 Markdown：先 esc 整段，再在转义后的文本上识别标题、表格、代码块、引用、分隔线、粗体、行内代码，不会引入任意 HTML
function md(s) {
  const out = [], lines = esc(s).split('\n')
  const inline = l => l.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  const isRow = l => /^\s*\|/.test(l)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    let m
    if (/^\s*```/.test(l)) {
      const code = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
      out.push(`<pre class=code>${code.join('\n')}</pre>`)
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
const reviewHTML = (r, saving) => [['🎯 能否通过', r.verdict], ['⚠️ 薄弱回答', r.weak], ['✨ 更好的答法', r.better],
  ...(txt(r.missed) ? [['🔁 这场没答好', `${txt(r.missed)}${saving ? '\n（保存后这些条目会标记「模拟没答好」）' : '\n（这些条目已标记「模拟没答好」）'}`]] : [])]
  .map(([h, v]) => `<div class=card><b>${h}</b><pre>${esc(txt(v) || '（AI 没给出这一项）')}</pre></div>`).join('')

// 巡检时间是北京时间字符串 "2026-11-02 10:31:41"
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
const when = s => s ? (s.startsWith(today()) ? '今天 ' : s.slice(5, 11)) + s.slice(11, 16) : ''
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '#'
const join = (a, sep = ' · ') => a.filter(Boolean).join(sep)
const jobTarget = j => S.targets.find(t => t.jobId === j.id)
// 投递进度：t.stages = [{ s, at, note? }]，按时间追加；当前阶段取最后一条
const STAGES = { applied: '📮 已投递', test: '📝 笔试', i1: '1️⃣ 一面', i2: '2️⃣ 二面', i3: '3️⃣ 三面', hr: '🤝 HR 面', offer: '🎉 Offer', reject: '❌ 终止' }
const stageNow = t => t.stages?.length ? STAGES[t.stages.at(-1).s] : ''
// 岗位标记存在面霸自己的 state 里（S.jobMarks[岗位 id] = { s, at }），巡检库保持只读
const MARKS = { star: '⭐ 收藏', applied: '📮 已投递', skip: '🙅 不合适' }
const markOf = j => S.jobMarks?.[j.id]?.s
// 待看：符合条件且还没标记；全部：包括不符合条件的
const VIEWS = { todo: ['待看', j => j.matched && !markOf(j)], star: ['收藏', j => markOf(j) === 'star'],
  applied: ['已投递', j => markOf(j) === 'applied'], skip: ['不合适', j => markOf(j) === 'skip'], all: ['全部', () => true] }

const radar = () => {
  if (!J) return ''
  const todo = J.filter(VIEWS.todo[1])
  const fresh = todo.filter(j => j.first_seen?.startsWith(today())).length
  const last = J.reduce((a, j) => j.last_seen > a ? j.last_seen : a, '')
  const n = k => J.filter(VIEWS[k][1]).length
  return `<h2>岗位雷达 <small>共 ${J.length} 个，最近巡检 ${when(last)}</small></h2>
<a class="row more" href="#/jobs">待看 ${todo.length} 个${fresh ? ` · <b class=new>今天新增 ${fresh}</b>` : ''}
<div class=meta><span>⭐ 收藏 ${n('star')}</span><span>📮 已投递 ${n('applied')}</span><span>🙅 不合适 ${n('skip')}</span></div></a>`
}

const home = () => `<h1>面霸</h1>
${radar()}
<h2>我的简历</h2>
<a class="row more" href="#/resume">${S.resume ? `已录入 ${S.resume.length} 字` : '还没有简历，点这里添加'}</a>
<h2>目标岗位</h2>
${S.targets.map(t => { const c = tally(t); return `<a class="row more" href="#/t/${t.id}"><b>${esc(t.company)}</b> · ${esc(t.role)}
<div class=meta>${pills(c)}<span>已准备 ${c.studied}/${t.gaps.length}</span><span>模拟 ${t.sessions.length} 次</span>${stageNow(t) ? `<span class="pill ${t.stages.at(-1).s === 'offer' ? 'ok' : ''}">${stageNow(t)}</span>` : ''}</div></a>` }).join('') || '<small>还没有目标岗位</small>'}
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
<div class=chips>${Object.entries(VIEWS).map(([k, [name, f]]) => `<button class="chip ${jf.view === k ? 'on' : ''}" onclick="jf.view = '${k}'; renderJobs(this)">${name} ${J.filter(f).length}</button>`).join('')}</div>
<div class=chips><button class="chip ${jf.sort === 'new' ? 'on' : ''}" onclick="jf.sort = 'new'; renderJobs(this)">按发现时间</button><button class="chip ${jf.sort === 'pay' ? 'on' : ''}" onclick="jf.sort = 'pay'; renderJobs(this)">按薪资上限</button><button class="chip ${jf.sort === 'score' ? 'on' : ''}" onclick="jf.sort = 'score'; renderJobs(this)">按匹配度</button></div>
<div id=jobs></div>`}`

const jobCard = j => {
  const t = jobTarget(j)
  const mk = S.jobMarks?.[j.id]
  return `<div class=card id="job-${esc(j.id)}">
<span class=pay>${esc(j.salary_desc)}</span>${j.score != null ? `<span class="sc ${j.score >= 75 ? 'ok' : j.score >= 50 ? 'warn' : ''}">${j.score}</span>` : ''}<b>${j.first_seen?.startsWith(today()) ? '<span class=new>新</span> ' : ''}${esc(j.job_name)}</b>
<small>${esc(join([j.brand_name, j.brand_scale, j.brand_stage, j.brand_industry]))}</small>
<small>${esc(join([join([j.area, j.business_area], ''), j.experience, j.degree, j.boss_name && join([j.boss_name, j.boss_title], ' ')]))}</small>
${j.skills ? `<div class=tags>${j.skills.split(',').slice(0, 10).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
${j.score_reason ? `<small class=why>${j.score} 分：${esc(j.score_reason)}</small>` : ''}
${j.jd ? `<details><summary>职位描述</summary><pre>${esc(j.jd)}</pre></details>` : ''}
<small>首次发现 ${when(j.first_seen)} · 出现 ${j.seen_count} 次${j.pushed ? ' · 已推送' : ''}${j.matched ? '' : ' · 不符合条件'}${mk ? ` · ${MARKS[mk.s]} ${new Date(mk.at).toLocaleDateString()}` : ''}</small>
<a class=btn href="${esc(safeUrl(j.url))}" target=_blank rel=noopener>去 BOSS 看</a>
${t ? `<a class=btn href="#/t/${t.id}">已建目标 ›</a>` : `<a class="btn primary" href="#/new/${encodeURIComponent(j.id)}">建为目标岗位</a>`}
<div class=chips>${Object.entries(MARKS).map(([s, name]) => `<button class="chip ${mk?.s === s ? 'on' : ''}" onclick="markJob(${esc(JSON.stringify(j.id))}, '${s}')">${name}</button>`).join('')}</div>
</div>`
}

// 只重画列表，搜索框不丢焦点；传入按钮时顺便重画按钮状态
function renderJobs(btn) {
  if (btn) return route()
  if (!$('#jobs') || !J) return
  const q = jf.q.trim().toLowerCase()
  const list = J.filter(j => VIEWS[jf.view][1](j) &&
    (!q || join([j.job_name, j.brand_name, j.skills, j.area, j.business_area, j.brand_industry, j.jd], ' ').toLowerCase().includes(q)))
  if (jf.sort === 'pay') list.sort((a, b) => (b.salary_max_k ?? -1) - (a.salary_max_k ?? -1)) // 稳定排序，同薪资仍按发现时间
  if (jf.sort === 'score') list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) // 没分数的排最后
  $('#jobs').innerHTML = `<small>${list.length} 个</small>` + (list.map(jobCard).join('') || '<p><small>没有匹配的岗位</small></p>')
}

const gapCard = (t, g, i) => `<a class="card more gapc ${g.strength || 'none'}" href="#/g/${t.id}/${i}"><b>${icon(g)} ${esc(g.requirement)}</b>
${g.evidence ? `<small>${esc(g.evidence)}</small>` : ''}<div class=probe>追问：${esc(g.probe)}</div>${g.study ? '<span class="pill ok">已准备</span>' : ''}${g.failed ? `<span class="pill bad">模拟没答好 ×${g.failed}</span>` : ''}</a>`

// 先列缺失和薄弱的（要重点准备），有力的折叠起来；链接仍用原始序号
const targetPage = t => {
  const c = tally(t)
  const rows = t.gaps.map((g, i) => ({ g, i }))
  const todo = rows.filter(x => x.g.strength !== 'strong').sort((a, b) => (a.g.strength === 'weak') - (b.g.strength === 'weak'))
  const done = rows.filter(x => x.g.strength === 'strong')
  return `${back('#/', '面霸')}<h1>${esc(t.company)}<small class=sub>${esc(t.role)}</small></h1>
<div class=meta>${pills(c)}<span>已准备 ${c.studied}/${t.gaps.length}</span></div>
<a class="btn primary wide" href="#/i/${t.id}">🎤 开始模拟面试</a>
<h2>投递进度 ${stageNow(t) ? `<small>当前：${stageNow(t)}</small>` : ''}</h2>
${t.stages?.length ? t.stages.slice().reverse().map(e => `<div class=card><b>${STAGES[e.s] || esc(e.s)}</b> <small style="display:inline">${new Date(e.at).toLocaleDateString()}</small>${e.note ? `<div>${esc(e.note)}</div>` : ''}</div>`).join('') : '<small>还没记录。先选日期（可选，默认今天）、填备注（可选），再点下面的阶段按钮</small>'}
<input type=date id=stgdate onchange="$('#stgnote')?.focus()">
<input id=stgnote placeholder="备注，可选（如 HR 微信、面试官风格）">
<div class=chips>${Object.entries(STAGES).map(([s, n]) => `<button class="chip ${t.stages?.at(-1)?.s === s ? 'on' : ''}" onclick="addStage('${t.id}', '${s}')">${n}</button>`).join('')}</div>
<h2>重点准备 <small>点进去看相关概念、回答思路，和 AI 练追问</small></h2>
${todo.map(x => gapCard(t, x.g, x.i)).join('') || '<small>没有薄弱项</small>'}
${done.length ? `<details class=fold><summary>✅ 简历能证明的 ${done.length} 条</summary>${done.map(x => gapCard(t, x.g, x.i)).join('')}</details>` : ''}
<h2>定制简历</h2>
${t.tailored ? `<details><summary>查看定制版</summary><pre>${esc(t.tailored)}</pre><button onclick="copyTailored('${t.id}')">复制</button></details>` : ''}
<button onclick="tailor('${t.id}')">${t.tailored ? '重新生成' : '按 JD 生成定制简历'}</button>
<h2>面经情报</h2>
${t.intel ? `<pre>${esc(t.intel)}</pre>` : ''}
<textarea id=intel rows=4 placeholder="粘贴小红书 / 牛客面经原文，可多篇"></textarea>
<button onclick="addIntel('${t.id}')">AI 提炼</button>
<h2>练习记录</h2>
${[...t.sessions].reverse().map(s => `<a class="row more" href="#/s/${t.id}/${s.id}">${new Date(s.date).toLocaleString()}<span class=stars>${'★'.repeat(s.rating)}</span></a>`).join('') || '<small>暂无，点上面「开始模拟面试」</small>'}
<div class=footer><button class=danger onclick="delTarget('${t.id}')">删除这个岗位</button></div>`
}

const ASKS = ['给我一个参考回答', '面试官接下来还会怎么追问？', '我先答一遍，你来点评']
const gapPage = (t, i) => {
  const g = t.gaps[i]
  if (!g) return targetPage(t)
  const st = g.study
  return `${back('#/t/' + t.id, t.company)}<h1 class=req>${icon(g)} ${esc(g.requirement)}</h1>
<div class="card gapc ${g.strength || 'none'}"><small>简历证据</small><div>${esc(g.evidence || '简历里没找到能证明这一条的经历')}</div>
<small class=lbl>面试官追问</small><div><b>${esc(g.probe)}</b></div></div>
<h2>相关概念 <small>点一个让 AI 展开讲</small></h2>
${st ? `<div class=concepts>${st.concepts.map((c, k) => `<a class="card more" href="javascript:askConcept(${k})"><b>${esc(c.name)}</b><div class=clamp>${esc(txt(c.explain))}</div></a>`).join('')}</div>` : '<small>生成中…</small>'}
<h2>回答思路 ${st ? `<button class=link onclick="genStudy(true)">重新生成</button>` : ''}</h2>
${st ? `<div class="card md">${md(txt(st.approach))}</div>` : '<small>生成中…</small>'}
<h2>问 AI ${g.chat?.length ? '<button class="link danger" onclick="clearGapChat()">清空对话</button>' : ''}</h2>
<div id=chat>${(g.chat || []).map(m => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg assistant md">${md(m.content)}</div>`).join('') || '<small>点上面的概念，或用下面的快捷提问开始</small>'}</div>
<div class=composer>
<div class=chips>${ASKS.map((q, k) => `<button class=chip onclick="askPreset(${k})">${esc(q)}</button>`).join('')}</div>
<div class=bar><textarea id=answer rows=1 placeholder="问 AI，或写下你的回答让它点评" oninput="grow(this)"></textarea><button class=primary onclick="askGap()">发送</button></div>
</div>`
}

const interviewPage = t => `${back('#/t/' + t.id)}<h1>${esc(title(t))}</h1>
<div id=chat></div>
<div id=controls class=composer>
  <textarea id=answer rows=2 placeholder="语音或打字回答" oninput="grow(this)"></textarea>
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
    : page === 'g' ? gapPage(t, +sub)
    : home()
  if (page === 'i' && t) startInterview(t)
  if (page === 'g' && t?.gaps[+sub] && !t.gaps[+sub].study) genStudy()
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

// 再点一次同一个标记就取消；标完只重画列表，当前位置不跳
async function markJob(id, s) {
  S.jobMarks ??= {}
  if (S.jobMarks[id]?.s === s) delete S.jobMarks[id]
  else S.jobMarks[id] = { s, at: new Date().toISOString() }
  const y = scrollY
  route()
  scrollTo(0, y)
  try { await save() } catch (e) { alert('保存失败：' + e.message) }
}

// ---------- 差距详情：概念讲解 + 回答思路 + 追问 ----------
// 当前打开的是哪条：每次都从 S 里现取，切回前台重新 load 后也不会写到旧对象上
const curGap = () => { const [, , tid, i] = location.hash.split('/'); return { t: target(tid), g: gapOf(tid, +i) } }

const genStudy = (force = false) => withBusy(async () => {
  const { t, g } = curGap()
  if (!g || (g.study && !force)) return
  const r = await askJSON(P.study, `${P.material(t)}\n\n<要求>${g.requirement}</要求>\n<简历证据>${g.evidence || '无'}</简历证据>\n<追问>${g.probe}</追问>`)
  const fresh = curGap().g
  if (!fresh || !Array.isArray(r.concepts)) throw new Error('AI 返回格式不对，再试一次')
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
const askConcept = k => askGap(`详细讲讲「${curGap().g.study.concepts[k].name}」：原理、和这道追问的关系、面试官常见的深挖点。`)
const askPreset = k => k === 2 ? $('#answer').focus() : askGap(ASKS[k])

function clearGapChat() {
  if (!confirm('清空这一条的对话记录？')) return
  withBusy(async () => {
    curGap().g.chat = []
    await save()
    route()
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
    iv.review = await askJSON(P.review(iv.t), transcript)
    $('#controls').hidden = true
    $('#review').innerHTML = `<h2>复盘</h2>${reviewHTML(iv.review, true)}
<p>自评这一轮后保存：</p>${[1, 2, 3, 4, 5].map(n => `<button onclick="saveSession(${n})">${'★'.repeat(n)}</button>`).join('')}
<button class=danger onclick="location.hash='#/t/${iv.t.id}'">丢弃</button>`
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
