#!/bin/sh
# 每日备份：面霸数据 state.json 和巡检库 jobs.db，存到 /root/backups/<日期>/，保留 30 天
# jobs.db 用 sqlite 在线备份，巡检同时在写也安全；state.json 由面霸原子替换写入，直接复制即可
set -e
D=/root/backups/$(date +%F)
mkdir -p "$D"
cp /opt/mianba/data/state.json "$D/state.json"
sqlite3 /opt/jobwatch/jobs.db ".backup '$D/jobs.db'"
gzip -f "$D/state.json" "$D/jobs.db"
find /root/backups -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
ls -la "$D"
