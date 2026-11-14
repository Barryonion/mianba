// 用法：node daily.js remind|question   读面霸的 state.json，通过 Bark 推送
//   remind   每天 8:30：明天（和今天）有笔试/面试的目标岗位，提醒复习
//   question 每天 12:30：从薄弱项里轮着挑一条追问当每日一题，点开直达差距详情页
// 配置在 /etc/ops.env：BARK_KEY、MIANBA_URL（如 https://xxx.ts.net）
const fs = require("fs");
const { BARK_KEY, NTFY_TOPIC, MIANBA_URL } = process.env;
const STATE = "/opt/mianba/data/state.json";
const LAST = "/var/lib/ops/daily-question.last";

async function bark(title, body, url, level = "active") {
  // Bark 发 iPhone，NTFY_TOPIC 配了再发一份到安卓
  if (BARK_KEY) {
    const r = await fetch(`https://api.day.app/${BARK_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title, body, url, group: "daily", level }),
    });
    if (!r.ok) throw new Error(`Bark ${r.status}`);
  }
  if (NTFY_TOPIC) {
    const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message: body, click: url }),
    });
    if (!r.ok) throw new Error(`ntfy ${r.status}`);
  }
  if (!BARK_KEY && !NTFY_TOPIC) throw new Error("BARK_KEY 和 NTFY_TOPIC 都没配");
}

(async () => {
  if (!BARK_KEY || !MIANBA_URL) throw new Error("缺 BARK_KEY 或 MIANBA_URL");
  const S = JSON.parse(fs.readFileSync(STATE, "utf8"));

  if (process.argv[2] === "remind") {
    // 阶段日期存的是北京时间日期（YYYY-MM-DD）；提醒今天和明天的面试/笔试
    const day = (off) => new Date(Date.now() + off * 86400e3).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 10);
    const hit = [];
    for (const t of S.targets || []) for (const e of t.stages || []) {
      const d = (e.at || "").slice(0, 10);
      if (["test", "i1", "i2", "i3", "hr"].includes(e.s) && [day(0), day(1)].includes(d))
        hit.push({ t, e, when: d === day(0) ? "今天" : "明天" });
    }
    for (const { t, e, when } of hit)
      await bark(`${when}${e.s === "test" ? "笔试" : "面试"}：${t.company}`, `${t.role}，记得复习薄弱项`, `${MIANBA_URL}/#/t/${t.id}`, "timeSensitive");
    console.log(`remind: ${hit.length} 条`);
    return;
  }

  if (process.argv[2] === "question") {
    // 候选池：薄弱项的追问 + 领域卡的建模题，轮着来，不连续重复
    const all = (S.targets || []).flatMap((t) => t.gaps.map((g, i) => ({ t, g, i })).filter((x) => x.g.strength !== "strong" && x.g.probe))
      .map((x) => ({ key: `${x.t.id}:${x.i}`, title: `每日一题 · ${x.t.company}`, body: `追问：${x.g.probe}`, url: `${MIANBA_URL}/#/g/${x.t.id}/${x.i}` }))
      .concat((S.domains || []).flatMap((d) => String(d.quiz || "").split("\n").map((s) => s.trim().replace(/^[-•]\s*/, "")).filter(Boolean)
        .map((q) => ({ key: `dom:${d.id}:${q.slice(0, 20)}`, title: `每日建模题 · ${d.name}`, body: q, url: `${MIANBA_URL}/#/d/${d.id}` }))));
    if (!all.length) return console.log("question: 没有候选，跳过");
    const last = fs.existsSync(LAST) ? fs.readFileSync(LAST, "utf8").trim() : "";
    const pos = Math.max(0, all.findIndex((x) => x.key === last));
    const pick = all[(pos + 1) % all.length];
    await bark(pick.title, pick.body, pick.url);
    fs.mkdirSync("/var/lib/ops", { recursive: true });
    fs.writeFileSync(LAST, pick.key);
    console.log(`question: ${pick.title} / ${pick.body.slice(0, 40)}`);
    return;
  }
  throw new Error("用法：node daily.js remind|question");
})().catch((e) => { console.error(e.message); process.exit(1); });
