# 面霸

自用面试辅助 Web 应用。电脑和手机共用同一份数据，手机可以「添加到主屏幕」当 App 用。

- **简历**：粘贴文字或导入 PDF（浏览器内用 pdf.js 抽取文字）
- **差距分析**：对照 JD 逐条判断简历能否证明（✅ 有力 / ⚠️ 薄弱 / ❌ 缺失），并预测面试官会怎么追问
- **定制简历**：按 JD 改写，只调整顺序和措辞，不新增事实，附改动说明
- **领域建模**：分析 JD 时自动识别涉及的 3-6 个业务领域，每个领域可生成知识卡（方法论锚定项目档案里的真实实践），支持「考我」式建模题追问练习；每日一题的候选池包含薄弱项追问和建模题
- **面经情报**：手动粘贴小红书、牛客的面经，AI 提炼要点，作为模拟面试的素材
- **模拟面试**：AI 扮演面试官，盯住薄弱点深挖追问；支持语音回答和朗读，结束后复盘、自评

## 架构

- `server.js`：零依赖 Node 服务（18+），负责静态文件、`/api/state` 整份状态读写、`/api/chat` 转发 LLM（OpenAI 兼容接口，默认智谱 `glm-5.3` 编程套餐端点，可用 `LLM_URL` / `LLM_MODEL` 环境变量改）
- `public/`：原生 HTML/JS，没有构建步骤
- 数据存在 `data/state.json`（已 gitignore），部署时不会被同步或覆盖
- 岗位雷达：环境变量 `JOBS_DB` 指向岗位巡检程序写的 SQLite（`jobs` 表），`/api/jobs` 只读查询，首页和 `#/jobs` 展示，可一键建为目标岗位，也可以标记为收藏、已投递或不合适（标记存在面霸自己的 state 里，岗位库保持只读）。用的是 Node 内置的 `node:sqlite`（Node 22.11 要加 `--experimental-sqlite`）。不配就不显示
- 只监听 127.0.0.1，由 `tailscale serve` 提供 HTTPS，tailnet 外的设备访问不到。语音功能必须在 HTTPS 下才能用

## 部署（阿里云 ECS）

```sh
./deploy.sh         # 在本机运行：rsync 代码到服务器 /opt/mianba（不碰 data/），写 systemd 服务（开机自启、挂了自动拉起）+ tailscale serve，再重启服务
./deploy.sh <key>   # 首次部署或换 key 时用：智谱个人 key 写进服务器 /etc/mianba.env（权限 600）的 LLM_KEY 行
```

要接岗位雷达，在服务器的 `/etc/mianba.env` 里加一行 `JOBS_DB=<jobs.db 路径>`，再执行 `./deploy.sh`。

服务器地址用环境变量 `MIANBA_HOST` 指定（如 `root@<服务器 IP>`），也可以写进仓库根目录的 `.deploy.local`（已 gitignore）。服务器需要已经装好 Node（`/usr/local/bin/node`），并且 Tailscale 已登录。访问地址是 `https://<服务器的 tailnet 机器名>.<你的 tailnet>.ts.net`，日志用 `journalctl -u mianba` 查看。

阿里云内网 DNS（100.100.2.x）落在 Tailscale 使用的 100.64/10 网段里，Tailscale 默认的 iptables 规则会丢掉 DNS 回包，导致整台机器解析不了域名。服务器上要先执行一次 `tailscale set --netfilter-mode=off --accept-dns=false`。

## 岗位巡检（`jobwatch/`）

岗位雷达的数据来源，和面霸部署在同一台服务器，独立运行（`/opt/jobwatch`，systemd 服务 `jobwatch`）。

- 常驻一个已登录 BOSS直聘的浏览器（patchright + Xvfb）。每天 8–23 点每 30–50 分钟按 `queries` 逐个搜索，每个关键词滚动加载 `pagesPerQuery` 页（每页 15 条），截获岗位列表接口
- 每轮搜完由 AI 对照简历给岗位打 0-100 匹配度分（`scorePerRound` 个/轮），岗位雷达可按匹配度排序。新岗位一轮合并成一条推送。每轮搜完再打开 `jdPerRound` 个（默认 8）还没有职位描述的符合条件岗位的详情页，把职位描述存进 `jd` 列，面霸里可以直接看，建目标岗位时自动填好 JD。薪资上限 ≥ `minMaxSalaryK`、职位名或技能含 `mustContain`、不是校招或实习的新岗位推送到 Bark
- 搜索条件变化后的第一轮只记录不推送，避免刷屏。遇到安全验证或登录失效时，最多每小时用 Bark 提醒一次
- BOSS 会把普通 Playwright 跳到空白页，所以用 patchright。机房 IP 会弹安全验证，需要人工点一下

```sh
jobwatch/deploy.sh   # 在本机运行：同步代码到 /opt/jobwatch（不碰 config.json、profile/、jobs.db 等运行数据），装依赖和 Chromium，写 systemd 服务，重启巡检
```

首次部署后，在服务器的 `/opt/jobwatch/config.json` 里填 `barkKey`（字段说明见 `config.example.json`），然后远程登录 BOSS：

```sh
ssh -f -N -L 5901:localhost:5900 $MIANBA_HOST   # 远程桌面只监听服务器的 127.0.0.1，走 SSH 隧道
open vnc://localhost:5901                       # 密码在服务器 /root/.vnc/plain；在浏览器里完成验证，用 BOSS App 扫码登录
```

日志用 `journalctl -u jobwatch` 查看。面霸要读岗位库，在 `/etc/mianba.env` 里写 `JOBS_DB=/opt/jobwatch/jobs.db`。

## 本地开发

```sh
LLM_KEY=xxx node server.js   # http://127.0.0.1:8787
```

## 运维（`ops/`）

和面霸、jobwatch 装在同一台服务器上，`ops/install.sh` 在本机运行，装到 `/opt/ops` 并写 systemd timer。配置在服务器的 `/etc/ops.env`（`BARK_KEY`、`GH_USER`、可选 `GH_TOKEN`），不进仓库。

- `backup.sh`：每天 03:30 备份 `state.json` 和 `jobs.db`（用 sqlite 在线备份）到 `/root/backups/<日期>/`，保留 30 天
- `watchdog.sh`：每 30 分钟检查一次。jobwatch 或面霸服务挂了，或者活跃时段内超过 2 小时没成功巡检一轮，就推送 Bark；同一问题最多每 3 小时提醒一次，恢复后推一条
- `gitnudge.js`：每天 21:00 推送当天 GitHub 提交情况，23:00 还没提交再提醒一次。不配 `GH_TOKEN` 只统计公开仓库
- `daily.js`：8:30 推送今天/明天的笔试面试提醒（读 state 里的投递进度）；12:30 从薄弱项轮着挑一条追问当每日一题，点开直达差距详情页
- `install-mac.sh`：在 Mac 上运行，装一个 launchd 任务，每天 22:30 把服务器的备份拉到 `~/Backups/mianba`
