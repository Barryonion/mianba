#!/bin/sh
# 巡检看门狗：服务挂了，或活跃时段内超过 2 小时没成功巡检一轮，就推送 Bark；
# 同一问题最多每 3 小时提醒一次，恢复后推一条「已恢复」
. /etc/ops.env
STAMP=/var/lib/ops/watchdog.alert
mkdir -p /var/lib/ops
msg=""
for s in jobwatch mianba; do systemctl is-active -q "$s" || msg="$msg$s 服务没在运行；"; done
h=$(date +%-H)
# 巡检 8 点开工（config.json 的 activeHours），10 点后才检查，给第一轮留足时间
if [ "$h" -ge 10 ] && [ "$h" -lt 23 ]; then
  last=$(sqlite3 /opt/jobwatch/jobs.db "select max(last_seen) from jobs")
  age=$(( ($(date +%s) - $(date -d "$last" +%s)) / 60 ))
  [ "$age" -gt 120 ] && msg="${msg}巡检已经 ${age} 分钟没成功完成一轮（最近 ${last}）；"
fi

# Bark 发 iPhone，NTFY_TOPIC 配了再发一份到安卓
bark() {
  [ -n "$BARK_KEY" ] && curl -s -m 15 -o /dev/null -X POST "https://api.day.app/$BARK_KEY" -H 'Content-Type: application/json; charset=utf-8' \
    -d "{\"title\":\"$1\",\"body\":\"$2\",\"group\":\"watchdog\",\"level\":\"$3\"}"
  [ -n "$NTFY_TOPIC" ] && curl -s -m 15 -o /dev/null -X POST "https://ntfy.sh/$NTFY_TOPIC" -H 'Content-Type: application/json; charset=utf-8' \
    -d "{\"topic\":\"$NTFY_TOPIC\",\"title\":\"$1\",\"message\":\"$2\"}"
  [ -n "$BARK_KEY$NTFY_TOPIC" ] || echo "BARK_KEY 和 NTFY_TOPIC 都没配"
}

if [ -n "$msg" ]; then
  echo "异常：$msg"
  if [ ! -f "$STAMP" ] || [ $(( $(date +%s) - $(stat -c %Y "$STAMP") )) -gt 10800 ]; then
    bark "服务器巡检异常" "$msg 看日志：journalctl -u jobwatch -n 50" timeSensitive && touch "$STAMP"
  fi
elif [ -f "$STAMP" ]; then
  echo "已恢复"
  bark "服务器巡检已恢复" "jobwatch 和面霸都正常" active && rm -f "$STAMP"
fi
