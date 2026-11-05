// 用法：node daily.js remind|question   读面霸的 state.json，通过 Bark 推送
//   remind   每天 8:30：明天（和今天）有笔试/面试的目标岗位，提醒复习
//   question 每天 12:30：从薄弱项里轮着挑一条追问当每日一题，点开直达差距详情页
// 配置在 /etc/ops.env：BARK_KEY、MIANBA_URL（如 https://xxx.ts.net）
const fs = require("fs");
const { BARK_KEY, MIANBA_URL } = process.env;
const STATE = "/opt/mianba/data/state.json";
const LAST = "/var/lib/ops/daily-question.last";

async function bark(title, body, url, level = "active") {
  const r = await fetch(`https://api.day.app/${BARK_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ title, body, url, group: "daily", level }),
  });
  if (!r.ok) throw new Error(`Bark ${r.status}`);
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
    // 候选：所有非 strong 的差距条目，按目标岗位顺序排，轮着来，不连续重复
    const all = (S.targets || []).flatMap((t) => t.gaps.map((g, i) => ({ t, g, i })).filter((x) => x.g.strength !== "strong" && x.g.probe));
    if (!all.length) return console.log("question: 没有薄弱项，跳过");
    const key = (x) => `${x.t.id}:${x.i}`;
    const last = fs.existsSync(LAST) ? fs.readFileSync(LAST, "utf8").trim() : "";
    const pos = Math.max(0, all.findIndex((x) => key(x) === last));
    const pick = all[(pos + 1) % all.length];
    await bark(`每日一题 · ${pick.t.company}`, `追问：${pick.g.probe}`, `${MIANBA_URL}/#/g/${pick.t.id}/${pick.i}`);
    fs.mkdirSync("/var/lib/ops", { recursive: true });
    fs.writeFileSync(LAST, key(pick));
    console.log(`question: ${pick.t.company} / ${pick.g.requirement}`);
    return;
  }
  throw new Error("用法：node daily.js remind|question");
})().catch((e) => { console.error(e.message); process.exit(1); });
