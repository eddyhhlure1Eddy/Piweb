#!/bin/bash
# PIweb 启动脚本
# 用于从前端页面启动 PIweb 服务

cd /home/user/ai-assistant

# 检查是否已经在运行
if pgrep -f "piweb" > /dev/null; then
    echo "PIweb 已经在运行中"
    exit 0
fi

# 启动 PIweb
echo "正在启动 PIweb..."
npm start -- --web &

# 等待服务启动
sleep 3
echo "PIweb 已启动"
