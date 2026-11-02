#!/bin/zsh
# 用法：./deploy.sh [LLM_KEY]   在本机运行，把代码同步到阿里云 ECS，以 systemd 常驻，并通过 tailscale serve 提供 HTTPS
# 传 key 时写入服务器 /etc/mianba.env 的 LLM_KEY 行（其他行如 JOBS_DB 保留）；不传就沿用服务器上已有的 key
# 服务器地址从环境变量 MIANBA_HOST 读取，也可以写在 .deploy.local 里（已 gitignore），例如 MIANBA_HOST=root@1.2.3.4
set -e
dir=${0:A:h}
[[ -f $dir/.deploy.local ]] && source $dir/.deploy.local
host=${MIANBA_HOST:?请设置 MIANBA_HOST，或写进 .deploy.local}

rsync -a --delete --exclude .git --exclude data/ --exclude .DS_Store --exclude .tokenize/ --exclude .deploy.local --exclude jobwatch/ $dir/ $host:/opt/mianba/

[[ -n $1 ]] && print -r -- "$1" | ssh $host 'umask 077; k=$(cat); touch /etc/mianba.env
{ grep -v "^LLM_KEY=" /etc/mianba.env || true; echo "LLM_KEY=$k"; } > /etc/mianba.env.tmp && mv /etc/mianba.env.tmp /etc/mianba.env'

ssh $host 'set -e
grep -q "^LLM_KEY=." /etc/mianba.env 2>/dev/null || { echo "服务器上还没有 key，执行 ./deploy.sh <key>" >&2; exit 1; }
cat > /etc/systemd/system/mianba.service <<EOF
[Unit]
Description=mianba interview helper
After=network-online.target
[Service]
WorkingDirectory=/opt/mianba
EnvironmentFile=/etc/mianba.env
ExecStart=/usr/local/bin/node --experimental-sqlite --no-warnings /opt/mianba/server.js
Restart=always
MemoryMax=200M
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mianba >/dev/null 2>&1
systemctl restart mianba
tailscale serve --bg 8787 >/dev/null
systemctl is-active mianba'
