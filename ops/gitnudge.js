// 每日提交提醒：查 GH_USER 今天（北京时间）在 GitHub 上的提交，用 Bark 推送结果。
// 用法：node nudge.js            每天固定推一条：有提交报数，没提交提醒
//       node nudge.js --if-none  只在还没提交时提醒（睡前补一次）
const { BARK_KEY, GH_USER, GH_TOKEN } = process.env;
const ifNone = process.argv.includes("--if-none");
const headers = { Accept: "application/vnd.github+json", "User-Agent": "gitnudge", ...(GH_TOKEN && { Authorization: `Bearer ${GH_TOKEN}` }) };
const day = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 10);
const since = new Date(`${day}T00:00:00+08:00`).toISOString();

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}`);
  return r.json();
}

async function bark(title, body, level = "active") {
  const r = await fetch(`https://api.day.app/${BARK_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ title, body, group: "gitnudge", level, url: `https://github.com/${GH_USER}` }),
  });
  if (!r.ok) throw new Error(`Bark ${r.status}`);
}

(async () => {
  // 有 token 时用 /user/repos 才能看到私有仓库；没有就只看公开仓库
  const repos = GH_TOKEN
    ? await gh("/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator")
    : await gh(`/users/${GH_USER}/repos?per_page=100&sort=pushed`);
  const counts = [];
  for (const r of repos.filter((r) => r.pushed_at >= since)) {
    const c = await gh(`/repos/${r.full_name}/commits?author=${GH_USER}&since=${since}&per_page=100`);
    if (c.length) counts.push([r.name, c.length]);
  }
  const total = counts.reduce((a, [, n]) => a + n, 0);
  console.log(day, total, JSON.stringify(counts));
  if (total) {
    if (!ifNone) await bark(`今天已提交 ${total} 次 ✅`, counts.map(([n, k]) => `${n} ×${k}`).join("、"));
  } else {
    await bark(ifNone ? "睡前提醒：今天还没提交代码" : "今天还没有提交代码 ⚠️", "写点什么、推一次，别断了", "timeSensitive");
  }
})().catch(async (e) => {
  console.error(e.message);
  await bark("提交检查失败", e.message).catch(() => {});
  process.exit(1);
});
