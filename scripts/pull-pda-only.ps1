# 只拉 pda 目录到本地（默认 D:\all，即 Android 工程根目录）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\pull-pda-only.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pull-pda-only.ps1 -TargetDir D:\all

param(
    [string]$TargetDir = "D:\all",
    [string]$Branch = "cursor/pda-android-app-e750",
    [string]$RepoUrl = "https://github.com/hu19857520623-hash/system.git"
)

$ErrorActionPreference = "Stop"
$TempDir = Join-Path $env:TEMP ("pda-sparse-" + [guid]::NewGuid().ToString("n"))

Write-Host "只同步 pda/ -> $TargetDir"
Write-Host "分支: $Branch"

try {
    git clone --depth 1 -b $Branch --filter=blob:none --sparse $RepoUrl $TempDir
    Set-Location $TempDir
    git sparse-checkout init --cone
    git sparse-checkout set pda

    $src = Join-Path $TempDir "pda"
    if (-not (Test-Path $src)) {
        throw "未找到 pda 目录"
    }

    if (Test-Path $TargetDir) {
        Write-Host "删除旧目录 $TargetDir ..."
        Remove-Item -Path $TargetDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path (Split-Path $TargetDir -Parent) -Force | Out-Null
    Move-Item -Path $src -Destination $TargetDir

    Write-Host ""
    Write-Host "完成。" -ForegroundColor Green
    Write-Host "预览: $TargetDir\preview\index.html"
    Write-Host "Android Studio 打开: $TargetDir"
}
finally {
    Set-Location $env:USERPROFILE
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
