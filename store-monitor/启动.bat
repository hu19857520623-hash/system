@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Takealot 卖家数据中心 :3456
echo.
echo [Takealot] 正在启动店铺监控代理（需已安装 Node.js 与 Chrome）...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js，请先安装: https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在 npm install ...
  call npm install
  if errorlevel 1 (
    echo npm install 失败
    pause
    exit /b 1
  )
)

echo.
echo 启动后请访问: http://localhost:3456
echo ERP 本地开发: http://localhost:5180  （需 dev-local.ps1 或单独启动 ERP）
echo 关闭本窗口即停止服务。
echo.

set LISTEN_HOST=127.0.0.1
set PORT=3456
npm start
