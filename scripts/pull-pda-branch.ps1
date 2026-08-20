# 将 PDA 分支干净拉到本地（默认 D:\all）
# 用法（PowerShell）：
#   cd D:\
#   powershell -ExecutionPolicy Bypass -File D:\all\scripts\pull-pda-branch.ps1
# 或指定目录：
#   powershell -ExecutionPolicy Bypass -File .\pull-pda-branch.ps1 -TargetDir D:\all

param(
    [string]$TargetDir = "D:\all",
    [string]$Branch = "cursor/pda-android-app-e750",
    [string]$RepoUrl = "https://github.com/hu19857520623-hash/system.git"
)

$ErrorActionPreference = "Stop"

Write-Host "目标目录: $TargetDir"
Write-Host "分支: $Branch"

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir | Out-Null
    Write-Host "已创建目录 $TargetDir"
}

$gitDir = Join-Path $TargetDir ".git"

if (Test-Path $gitDir) {
    Write-Host "检测到已有 Git 仓库，执行干净同步..."
    Set-Location $TargetDir
    git fetch origin
    git checkout $Branch
    git reset --hard "origin/$Branch"
    git clean -fd
} else {
    $items = Get-ChildItem -Path $TargetDir -Force -ErrorAction SilentlyContinue
    if ($items -and $items.Count -gt 0) {
        Write-Host "错误: $TargetDir 不是 Git 仓库且目录非空。" -ForegroundColor Red
        Write-Host "请清空该目录，或改用: git clone ... D:\all\system"
        exit 1
    }
    Write-Host "目录为空，开始克隆..."
    git clone -b $Branch --single-branch $RepoUrl $TargetDir
}

Set-Location $TargetDir
Write-Host ""
Write-Host "完成。当前分支:" -ForegroundColor Green
git branch -vv
Write-Host ""
Write-Host "PDA 预览: $TargetDir\pda\preview\index.html"
Write-Host "Android 工程: $TargetDir\pda"
