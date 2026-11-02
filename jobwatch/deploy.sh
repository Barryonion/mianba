#!/bin/zsh
# 用法：jobwatch/deploy.sh   在本机运行，把巡检程序同步到服务器 /opt/jobwatch，装依赖，写 systemd 服务，再重启巡检
# 服务器地址和面霸共用：环境变量 MIANBA_HOST，或仓库根目录的 .deploy.local
# 服务器上的运行数据不会被同步或覆盖：config.json（含 Bark key）、profile/（登录态）、jobs.db、seen.json、last.json、.scankey
set -e
dir=${0:A:h}
[[ -f $dir/../.deploy.local ]] && source $dir/../.deploy.local
host=${MIANBA_HOST:?请设置 MIANBA_HOST，或写进 .deploy.local}

rsync -a --delete --exclude node_modules/ --exclude profile/ --exclude config.json --exclude 'jobs.db*' \
  --exclude seen.json --exclude last.json --exclude .scankey --exclude .DS_Store --exclude deploy.sh \
  $dir/ $host:/opt/jobwatch/

ssh $host 'set -e
cd /opt/jobwatch
export DEBIAN_FRONTEND=noninteractive
dpkg -s xvfb x11vnc fluxbox fonts-noto-cjk >/dev/null 2>&1 || apt-get install -y -qq xvfb x11vnc fluxbox fonts-noto-cjk >/dev/null
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright npx patchright install chromium >/dev/null
[ -f config.json ] || { cp config.example.json config.json; echo "已生成 /opt/jobwatch/config.json，记得填 barkKey" >&2; }

# 远程桌面密码：没有就随机生成一个，明文存在 /root/.vnc/plain（权限 600）
if [ ! -f /root/.vnc/passwd ]; then
  mkdir -p /root/.vnc; p=$(head -c 12 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 8)
  x11vnc -storepasswd "$p" /root/.vnc/passwd >/dev/null 2>&1; (umask 077; echo "$p" > /root/.vnc/plain)
fi

unit() { cat > /etc/systemd/system/$1.service; }
unit jw-xvfb <<EOF
[Unit]
Description=Xvfb display :99 for jobwatch
[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24 -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
EOF
unit jw-wm <<EOF
[Unit]
Description=fluxbox on :99
After=jw-xvfb.service
Requires=jw-xvfb.service
[Service]
Environment=DISPLAY=:99
ExecStart=/usr/bin/fluxbox
Restart=always
[Install]
WantedBy=multi-user.target
EOF
unit jw-vnc <<EOF
[Unit]
Description=x11vnc on :99 (localhost only, via SSH tunnel)
After=jw-xvfb.service
Requires=jw-xvfb.service
[Service]
ExecStart=/usr/bin/x11vnc -display :99 -localhost -rfbport 5900 -rfbauth /root/.vnc/passwd -forever -shared -noxdamage
Restart=always
[Install]
WantedBy=multi-user.target
EOF
unit jobwatch <<EOF
[Unit]
Description=BOSS job watcher
After=jw-xvfb.service jw-wm.service network-online.target
Requires=jw-xvfb.service
[Service]
WorkingDirectory=/opt/jobwatch
Environment=DISPLAY=:99
ExecStart=/usr/local/bin/node --experimental-sqlite --no-warnings watcher.js
Restart=always
RestartSec=60
TimeoutStopSec=20
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now jw-xvfb jw-wm jw-vnc >/dev/null 2>&1
systemctl enable jobwatch >/dev/null 2>&1
systemctl restart jobwatch
systemctl is-active jobwatch'
