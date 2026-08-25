# 一键拉起本地 ERP + OMS（各开一个窗口，关掉窗口即停）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Start-DevWindow([string]$title, [string]$cwd, [string]$command) {
  Start-Process powershell -WorkingDirectory $cwd -ArgumentList @(
    '-NoExit',
    '-Command',
    "Write-Host '[$title] $cwd' -ForegroundColor Cyan; $command"
  )
}

Start-DevWindow 'ERP API :3000' (Join-Path $root 'erp\backend') 'npm run start:prod'
Start-DevWindow 'ERP UI :5180' (Join-Path $root 'erp\frontend') 'npm run dev'
Start-DevWindow 'Takealot proxy :3456' (Join-Path $root 'store-monitor') 'npm start'
Start-DevWindow 'OMS :3001 / :5173' (Join-Path $root 'oms') '$env:NODE_ENV=''development''; $env:OMS_ALLOW_INSECURE_DEV_AUTH=''true''; npm run dev'

Write-Host '已启动 4 个窗口：ERP API、ERP 前端、Takealot 代理、OMS。' -ForegroundColor Green
Write-Host 'ERP  http://localhost:5180/   OMS  http://127.0.0.1:5173/'
