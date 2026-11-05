#!/bin/zsh
# 用法：ops/install-mac.sh   在 MacBook 上运行：装一个 launchd 任务，每天 22:30 把服务器的 /root/backups 拉到 ~/Backups/mianba
# （服务器盘坏了也还有一份；Mac 当时在睡眠的话，醒来后 launchd 会补跑）
set -e
dir=${0:A:h}
[[ -f $dir/../.deploy.local ]] && source $dir/../.deploy.local
host=${MIANBA_HOST:?请设置 MIANBA_HOST，或写进 .deploy.local}
plist=$HOME/Library/LaunchAgents/com.barry.mianba-backup.plist
mkdir -p $HOME/Backups/mianba
cat > $plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.barry.mianba-backup</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/rsync</string><string>-a</string><string>--delete</string>
    <string>-e</string><string>ssh -o BatchMode=yes -o ConnectTimeout=20</string>
    <string>$host:/root/backups/</string><string>$HOME/Backups/mianba/</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/mianba-backup.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/mianba-backup.log</string>
</dict></plist>
PLIST
launchctl bootout gui/$UID/com.barry.mianba-backup 2>/dev/null || true
launchctl bootstrap gui/$UID $plist
echo "已安装，手动拉一次：launchctl kickstart gui/$UID/com.barry.mianba-backup"
