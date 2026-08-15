@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 Takealot OMS 原型...
call npm.cmd run dev -- --host 127.0.0.1 --port 5173
pause
