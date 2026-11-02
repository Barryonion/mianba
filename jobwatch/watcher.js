// BOSS直聘新岗位巡检：常驻一个已登录的浏览器，定时刷新搜索页，截获岗位列表接口，新岗位推送到 Bark。
const fs = require("fs");
const path = require("path");
const { chromium } = require("patchright");
const { saveJob, markPushed, needJd, saveJd } = require("./store");

const DIR = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
const SEEN_FILE = path.join(DIR, "seen.json");
const LOG = (...a) => console.log(new Date().toLocaleString("zh-CN", { hour12: false }), ...a);

const seen = fs.existsSync(SEEN_FILE) ? JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) : {};
const saveSeen = () => fs.writeFileSync(SEEN_FILE, JSON.stringify(seen));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

async function bark(title, body, url) {
  if (!CONFIG.barkKey) return LOG("[bark 未配置]", title, body);
  try {
    const res = await fetch(`https://api.day.app/${CONFIG.barkKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title, body, url, group: "jobwatch" }),
    });
    if (!res.ok) LOG("bark 失败", res.status);
  } catch (e) {
    LOG("bark 异常", e.message);
  }
}

// "30-45K·15薪" -> 45；"面议"等解析不了的返回 null（保留，交给人判断）
function maxSalaryK(desc = "") {
  const m = desc.match(/(\d+)(?:-(\d+))?K/i);
  if (!m) return null;
  return Number(m[2] || m[1]);
}

// 是否符合推送条件：薪资上限达标（面议也算），不是校招/实习，且与 Java 相关
function isMatch(j, max) {
  if (max !== null && max < CONFIG.minMaxSalaryK) return false;
  if (/在校|应届/.test(j.jobExperience || "") || /校招|实习|届/.test(j.jobName || "")) return false;
  // 职位名或技能标签必须含关键字（如 java），过滤"技术专家"搜出的无关岗位
  const text = `${j.jobName || ""} ${(j.skills || []).join(",")}`;
  if (CONFIG.mustContain && !new RegExp(CONFIG.mustContain, "i").test(text)) return false;
  return true;
}

function inActiveHours() {
  const h = new Date().getHours();
  return h >= CONFIG.activeHours[0] && h < CONFIG.activeHours[1];
}

let lastBlockedNotice = 0;
async function notifyBlocked(reason) {
  // 同一类问题最多每小时提醒一次
  if (Date.now() - lastBlockedNotice < 3600e3) return;
  lastBlockedNotice = Date.now();
  await bark("BOSS 巡检需要人工处理", `${reason}，请连远程桌面处理`);
}

// 打开一个关键词的搜索页，慢慢往下滚，拿够 pagesPerQuery 页就停（页面是滚动加载，每页 15 条）
async function scanQuery(page, query) {
  const pages = [];
  let firstResolve;
  const first = new Promise((r) => (firstResolve = r));
  const onResp = async (r) => {
    if (!r.url().includes("/search/joblist.json")) return;
    const d = await r.json().catch(() => null);
    if (d) pages.push(d);
    firstResolve();
  };
  page.on("response", onResp);
  try {
    const url = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${CONFIG.city}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await Promise.race([first, sleep(30000)]);
    const cur = page.url();
    if (/verify|security-check/.test(cur)) return { blocked: "遇到安全验证" };
    if (/login/.test(cur)) return { blocked: "登录已失效" };
    if (!pages.length) return { blocked: "没拿到岗位列表（页面结构可能变了）" };
    if (pages[0].code !== 0) return { blocked: `接口返回 code=${pages[0].code} ${pages[0].message || ""}` };

    let idle = 0;
    while (pages.length < CONFIG.pagesPerQuery && idle < 3 && pages.at(-1).zpData?.hasMore !== false) {
      const before = pages.length;
      await page.mouse.move(rand(500, 900), rand(300, 600));
      for (let k = 0; k < 4 && pages.length === before; k++) {
        await page.mouse.wheel(0, rand(500, 800));
        await sleep(rand(600, 1200));
      }
      const t0 = Date.now();
      while (pages.length === before && Date.now() - t0 < 6000) await sleep(300);
      idle = pages.length === before ? idle + 1 : 0;
      await sleep(rand(1500, 3500));
    }
    fs.writeFileSync(path.join(DIR, "last.json"), JSON.stringify(pages.at(-1), null, 1)); // 留一份原始数据便于排查
    const jobs = pages.filter((d) => d.code === 0).flatMap((d) => d.zpData?.jobList || []);
    return { jobs, pageCount: pages.length };
  } finally {
    page.off("response", onResp);
  }
}

// 补抓职位描述：每轮挑几个还没抓过的符合条件岗位，打开详情页读 .job-sec-text（服务端渲染，不用截接口）
async function fetchJds(page) {
  let ok = 0;
  for (const j of needJd(CONFIG.jdPerRound ?? 8)) {
    try {
      await page.goto(j.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e) {
      LOG("详情页打不开:", j.job_name, e.message); // 下轮再试
      continue;
    }
    const cur = page.url();
    if (/verify|security-check/.test(cur)) return { ok, blocked: "打开详情页时遇到安全验证" };
    if (/login/.test(cur)) return { ok, blocked: "登录已失效" };
    const jd = await page.locator(".job-sec-text").first().innerText({ timeout: 15000 }).catch(() => null);
    // 页面正常但没有描述（职位已关闭等）记空字符串，不再重抓
    saveJd(j.id, (jd || "").trim());
    if (jd) ok++;
    await page.mouse.wheel(0, rand(200, 600));
    await sleep(rand(6000, 12000));
  }
  return { ok };
}

async function scanOnce(page) {
  const jobs = [];
  const stats = [];
  const queries = [...CONFIG.queries].sort(() => Math.random() - 0.5); // 每轮打乱顺序
  for (const q of queries) {
    const r = await scanQuery(page, q);
    if (r.blocked) return r;
    for (const j of r.jobs) j._query = q;
    jobs.push(...r.jobs);
    stats.push(`${q}:${r.pageCount}页${r.jobs.length}条`);
    await sleep(rand(8000, 15000));
  }
  return { jobs, stats };
}

async function main() {
  const ctx = await chromium.launchPersistentContext(path.join(DIR, "profile"), {
    headless: false,
    channel: "chromium",
    locale: "zh-CN",
    viewport: null,
    args: ["--window-size=1440,900", "--window-position=0,0"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  LOG("浏览器已启动");
  process.on("SIGTERM", async () => {
    await ctx.close().catch(() => {});
    process.exit(0);
  });

  // 首次运行或搜索条件变了：第一轮只记录不推送，避免一次性推送大量"新"岗位
  const KEY_FILE = path.join(DIR, ".scankey");
  const scanKey = JSON.stringify([CONFIG.queries, CONFIG.pagesPerQuery, CONFIG.city]);
  const keyChanged = !fs.existsSync(KEY_FILE) || fs.readFileSync(KEY_FILE, "utf8") !== scanKey;
  let firstRun = Object.keys(seen).length === 0 || keyChanged;
  for (;;) {
    if (inActiveHours()) {
      try {
        const r = await scanOnce(page);
        if (r.blocked) {
          LOG("受阻:", r.blocked);
          await notifyBlocked(r.blocked);
        } else {
          let fresh = 0;
          const roundSeen = new Set();
          for (const j of r.jobs) {
            const id = j.encryptJobId;
            if (roundSeen.has(id)) continue; // 不同关键词/页可能重复
            roundSeen.add(id);
            if (!id) continue;
            const max = maxSalaryK(j.salaryDesc);
            const matched = isMatch(j, max);
            try {
              saveJob(j, { query: j._query, salaryMaxK: max, matched });
            } catch (e) {
              LOG("入库失败:", id, e.message);
            }
            if (seen[id]) continue;
            seen[id] = Date.now();
            if (!matched) continue;
            fresh++;
            if (!firstRun) {
              const where = [j.areaDistrict, j.businessDistrict].filter(Boolean).join("·");
              await bark(
                `${j.salaryDesc} ${j.jobName}`,
                `${j.brandName}｜${where}｜${j.jobExperience || ""} ${j.jobDegree || ""}｜${j.brandScaleName || ""}`,
                `https://www.zhipin.com/job_detail/${id}.html`
              );
              markPushed(id);
              await sleep(500);
            }
          }
          saveSeen();
          LOG(`本轮 ${r.stats.join(" ")}，去重后 ${roundSeen.size} 条，新增符合条件 ${fresh} 条${firstRun ? "（首轮只记录不推送）" : ""}`);
          const d = await fetchJds(page);
          if (d.ok) LOG(`补抓职位描述 ${d.ok} 条`);
          if (d.blocked) {
            LOG("受阻:", d.blocked);
            await notifyBlocked(d.blocked);
          }
          if (firstRun && r.jobs.length) {
            await bark("BOSS 巡检已启动", `首轮记录 ${roundSeen.size} 个岗位（符合条件 ${fresh} 个），之后有新岗位会推送`);
            fs.writeFileSync(KEY_FILE, scanKey);
            firstRun = false;
          }
        }
      } catch (e) {
        LOG("异常:", e.message);
      }
    }
    const waitMin = rand(CONFIG.intervalMin[0], CONFIG.intervalMin[1]);
    LOG(`下次巡检约 ${waitMin.toFixed(0)} 分钟后`);
    await sleep(waitMin * 60e3);
  }
}

main().catch((e) => {
  LOG("致命错误:", e);
  process.exit(1);
});
