#!/bin/zsh
# 用法：ops/install.sh   在本机运行，把运维脚本装到服务器 /opt/ops，写 systemd timer：
#   ops-backup     每天 03:30 备份 state.json 和 jobs.db（/root/backups，保留 30 天）
#   ops-watchdog   每 30 分钟检查服务和巡检是否正常，异常推 Bark
#   gitnudge       每天 21:00 推送当天 GitHub 提交情况；gitnudge-late 23:00 仍没提交再提醒
# 配置在服务器 /etc/ops.env（BARK_KEY、GH_USER、可选 GH_TOKEN），不进仓库；首次安装时从 jobwatch 的 config.json 取 Bark key
set -e
dir=${0:A:h}
[[ -f $dir/../.deploy.local ]] && source $dir/../.deploy.local
host=${MIANBA_HOST:?请设置 MIANBA_HOST，或写进 .deploy.local}

rsync -a --delete --exclude install.sh --exclude install-mac.sh $dir/ $host:/opt/ops/
ssh $host 'set -e
chmod +x /opt/ops/*.sh
if [ ! -f /etc/ops.env ]; then
  K=$(python3 -c "import json;print(json.load(open(\"/opt/jobwatch/config.json\"))[\"barkKey\"])")
  (umask 077; printf "BARK_KEY=%s\nGH_USER=Barryonion\n# GH_TOKEN=  可选：GitHub 只读 token，填上后私有仓库的提交也算\n" "$K" > /etc/ops.env)
fi
svc() { cat > /etc/systemd/system/$1.service <<EOT
[Unit]
Description=$2
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=/etc/ops.env
ExecStart=$3
EOT
cat > /etc/systemd/system/$1.timer <<EOT
[Unit]
Description=$2
[Timer]
OnCalendar=$4
Persistent=true
[Install]
WantedBy=timers.target
EOT
}
svc ops-backup "daily backup of mianba and jobwatch data" "/opt/ops/backup.sh" "*-*-* 03:30:00 Asia/Shanghai"
svc ops-remind "interview reminder from mianba state" "/usr/local/bin/node /opt/ops/daily.js remind" "*-*-* 08:30:00 Asia/Shanghai"
svc ops-question "daily interview question from weak gaps" "/usr/local/bin/node /opt/ops/daily.js question" "*-*-* 12:30:00 Asia/Shanghai"
svc ops-watchdog "check jobwatch and mianba health" "/opt/ops/watchdog.sh" "*:00/30"
svc gitnudge "daily GitHub commit check" "/usr/local/bin/node /opt/ops/gitnudge.js" "*-*-* 21:00:00 Asia/Shanghai"
svc gitnudge-late "late reminder if no GitHub commit today" "/usr/local/bin/node /opt/ops/gitnudge.js --if-none" "*-*-* 23:00:00 Asia/Shanghai"
systemctl daemon-reload
grep -q ^MIANBA_URL= /etc/ops.env || echo "提醒：/etc/ops.env 里还没有 MIANBA_URL，daily.js 的面试提醒和每日一题需要它" >&2
systemctl enable --now ops-backup.timer ops-watchdog.timer ops-remind.timer ops-question.timer gitnudge.timer gitnudge-late.timer >/dev/null 2>&1
systemctl list-timers "ops-*" "gitnudge*" --no-pager'
