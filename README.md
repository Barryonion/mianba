# 面霸

自用面试辅助 Web 应用。电脑和手机共用同一份数据，手机可以「添加到主屏幕」当 App 用。

- **简历**：粘贴文字或导入 PDF（浏览器内用 pdf.js 抽取文字）
- **差距分析**：对照 JD 逐条判断简历能否证明（✅ 有力 / ⚠️ 薄弱 / ❌ 缺失），并预测面试官会怎么追问
- **定制简历**：按 JD 改写，只调整顺序和措辞，不新增事实，附改动说明
- **面经情报**：手动粘贴小红书、牛客的面经，AI 提炼要点，作为模拟面试的素材
- **模拟面试**：AI 扮演面试官，盯住薄弱点深挖追问；支持语音回答和朗读，结束后复盘、自评

## 架构

- `server.js`：零依赖 Node 服务（18+），负责静态文件、`/api/state` 整份状态读写、`/api/chat` 转发 LLM（OpenAI 兼容接口，默认智谱 `glm-5.3` 编程套餐端点，可用 `LLM_URL` / `LLM_MODEL` 环境变量改）
- `public/`：原生 HTML/JS，没有构建步骤
- 数据存在 `data/state.json`（已 gitignore），部署时不会被同步或覆盖
- 只监听 127.0.0.1，由 `tailscale serve` 提供 HTTPS，tailnet 外的设备访问不到。语音功能必须在 HTTPS 下才能用

## 部署（阿里云 ECS）

```sh
./deploy.sh         # 在本机运行：rsync 代码到服务器 /opt/mianba（不碰 data/），写 systemd 服务（开机自启、挂了自动拉起）+ tailscale serve，再重启服务
./deploy.sh <key>   # 首次部署或换 key 时用：智谱个人 key 写进服务器的 /etc/mianba.env（权限 600）
```

服务器地址用环境变量 `MIANBA_HOST` 指定（如 `root@<服务器 IP>`），也可以写进仓库根目录的 `.deploy.local`（已 gitignore）。服务器需要已经装好 Node（`/usr/local/bin/node`），并且 Tailscale 已登录。访问地址是 `https://<服务器的 tailnet 机器名>.<你的 tailnet>.ts.net`，日志用 `journalctl -u mianba` 查看。

阿里云内网 DNS（100.100.2.x）落在 Tailscale 使用的 100.64/10 网段里，Tailscale 默认的 iptables 规则会丢掉 DNS 回包，导致整台机器解析不了域名。服务器上要先执行一次 `tailscale set --netfilter-mode=off --accept-dns=false`。

## 本地开发

```sh
LLM_KEY=xxx node server.js   # http://127.0.0.1:8787
```
