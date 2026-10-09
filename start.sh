#!/bin/sh
cd "$(dirname "$0")"
if ! lsof -i :5180 -sTCP:LISTEN >/dev/null 2>&1; then
  command -v node >/dev/null 2>&1 || { echo "需要 Node.js >= 18，去 nodejs.org 安装"; exit 1; }
  nohup node serve.mjs >/dev/null 2>&1 &
  sleep 2
fi
if command -v open >/dev/null 2>&1; then open http://localhost:5180; elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5180; else echo "打开 http://localhost:5180 观赛"; fi
