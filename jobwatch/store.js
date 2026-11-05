// 岗位数据留存：每次拉到的岗位全部写入 SQLite，同一岗位只存一条，重复看到时更新字段和最近时间。
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "jobs.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,   -- encryptJobId
    job_name        TEXT,
    salary_desc     TEXT,
    salary_max_k    INTEGER,            -- 薪资上限（K），面议为空
    brand_name      TEXT,
    brand_scale     TEXT,
    brand_stage     TEXT,
    brand_industry  TEXT,
    city            TEXT,
    area            TEXT,
    business_area   TEXT,
    experience      TEXT,
    degree          TEXT,
    skills          TEXT,               -- 逗号分隔
    welfare         TEXT,               -- 逗号分隔
    boss_name       TEXT,
    boss_title      TEXT,
    url             TEXT,
    query           TEXT,               -- 命中的搜索关键词
    matched         INTEGER,            -- 是否符合推送条件
    pushed          INTEGER DEFAULT 0,  -- 是否推送过
    first_seen      TEXT,
    last_seen       TEXT,
    seen_count      INTEGER DEFAULT 1,
    raw             TEXT                -- 接口原始 JSON
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen);
`);
// 后加的列：职位描述要打开详情页才有，单独补抓
const cols = new Set(db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name));
if (!cols.has("jd")) db.exec("ALTER TABLE jobs ADD COLUMN jd TEXT");       // 职位描述全文，抓到但页面没有描述时为空字符串
if (!cols.has("jd_at")) db.exec("ALTER TABLE jobs ADD COLUMN jd_at TEXT"); // 抓取时间，非空表示不用再抓
if (!cols.has("score")) db.exec("ALTER TABLE jobs ADD COLUMN score INTEGER");       // AI 匹配度 0-100
if (!cols.has("score_reason")) db.exec("ALTER TABLE jobs ADD COLUMN score_reason TEXT");
if (!cols.has("score_at")) db.exec("ALTER TABLE jobs ADD COLUMN score_at TEXT");

const upsert = db.prepare(`
  INSERT INTO jobs (id, job_name, salary_desc, salary_max_k, brand_name, brand_scale, brand_stage, brand_industry,
    city, area, business_area, experience, degree, skills, welfare, boss_name, boss_title, url, query, matched,
    first_seen, last_seen, raw)
  VALUES ($id, $job_name, $salary_desc, $salary_max_k, $brand_name, $brand_scale, $brand_stage, $brand_industry,
    $city, $area, $business_area, $experience, $degree, $skills, $welfare, $boss_name, $boss_title, $url, $query, $matched,
    $now, $now, $raw)
  ON CONFLICT(id) DO UPDATE SET
    job_name = excluded.job_name, salary_desc = excluded.salary_desc, salary_max_k = excluded.salary_max_k,
    brand_name = excluded.brand_name, brand_scale = excluded.brand_scale, brand_stage = excluded.brand_stage,
    brand_industry = excluded.brand_industry, city = excluded.city, area = excluded.area,
    business_area = excluded.business_area, experience = excluded.experience, degree = excluded.degree,
    skills = excluded.skills, welfare = excluded.welfare, boss_name = excluded.boss_name,
    boss_title = excluded.boss_title, matched = excluded.matched, raw = excluded.raw,
    last_seen = excluded.last_seen, seen_count = seen_count + 1
`);
const markPushedStmt = db.prepare(`UPDATE jobs SET pushed = 1 WHERE id = ?`);
const needJdStmt = db.prepare(`SELECT id, url, job_name FROM jobs WHERE matched = 1 AND jd_at IS NULL ORDER BY first_seen DESC LIMIT ?`);
const saveJdStmt = db.prepare(`UPDATE jobs SET jd = ?, jd_at = ? WHERE id = ?`);
const needScoreStmt = db.prepare(`SELECT id, job_name, salary_desc, skills, jd FROM jobs WHERE matched = 1 AND jd != '' AND score IS NULL ORDER BY first_seen DESC LIMIT ?`);
const saveScoreStmt = db.prepare(`UPDATE jobs SET score = ?, score_reason = ?, score_at = ? WHERE id = ?`);

const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }); // 2026-11-02 09:30:00
const list = (v) => (Array.isArray(v) ? v.join(",") : v || null);

function saveJob(j, { query, salaryMaxK, matched, seenAt = now() }) {
  upsert.run({
    $id: j.encryptJobId,
    $job_name: j.jobName ?? null,
    $salary_desc: j.salaryDesc ?? null,
    $salary_max_k: salaryMaxK,
    $brand_name: j.brandName ?? null,
    $brand_scale: j.brandScaleName ?? null,
    $brand_stage: j.brandStageName ?? null,
    $brand_industry: j.brandIndustry ?? null,
    $city: j.cityName ?? null,
    $area: j.areaDistrict ?? null,
    $business_area: j.businessDistrict ?? null,
    $experience: j.jobExperience ?? null,
    $degree: j.jobDegree ?? null,
    $skills: list(j.skills),
    $welfare: list(j.welfareList),
    $boss_name: j.bossName ?? null,
    $boss_title: j.bossTitle ?? null,
    $url: `https://www.zhipin.com/job_detail/${j.encryptJobId}.html`,
    $query: query ?? null,
    $matched: matched ? 1 : 0,
    $now: seenAt,
    $raw: JSON.stringify(j, (k, v) => (k === "_query" ? undefined : v)),
  });
}

module.exports = {
  db,
  saveJob,
  markPushed: (id) => markPushedStmt.run(id),
  needJd: (limit) => needJdStmt.all(limit),
  saveJd: (id, jd) => saveJdStmt.run(jd, now(), id),
  needScore: (limit) => needScoreStmt.all(limit),
  saveScore: (id, score, reason) => saveScoreStmt.run(score, reason, now(), id),
};
