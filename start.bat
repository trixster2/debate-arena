@echo off
title Debate Arena
cd /d "%~dp0"
netstat -ano | findstr ":5180" | findstr "LISTENING" >nul 2>&1 && goto open
node -v >nul 2>&1 || (echo Node.js 18+ required - download at nodejs.org && pause && exit /b 1)
start "debate-arena server" /min node serve.mjs
ping -n 3 127.0.0.1 >nul
:open
start "" http://localhost:5180
