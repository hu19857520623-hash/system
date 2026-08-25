# Sync local ERP project to GitHub repo hu19857520623-hash/hxxxx under ERP/ folder
# Usage: powershell -ExecutionPolicy Bypass -File scripts/push-to-hxxxx.ps1

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/hu19857520623-hash/Hxxxx.git'
$SourceDir = 'c:\Users\15693\Desktop\erp'
$TempDir = Join-Path $env:TEMP ('hxxxx-erp-push-' + (Get-Date -Format 'yyyyMMddHHmmss'))

Write-Host "Source: $SourceDir"
Write-Host "Temp clone: $TempDir"

if (Test-Path $TempDir) { Remove-Item -Recurse -Force $TempDir }
git clone $RepoUrl $TempDir
if ($LASTEXITCODE -ne 0) {
    Write-Error 'git clone failed. Check network/VPN access to github.com and retry.'
}
Set-Location $TempDir

$ErpDir = Join-Path $TempDir 'ERP'
if (-not (Test-Path $ErpDir)) { New-Item -ItemType Directory -Path $ErpDir | Out-Null }

robocopy $SourceDir $ErpDir /MIR /XD node_modules dist .git .vite uploads backups .cursor /XF .env /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

git add ERP/
$status = git status --porcelain
if (-not $status) {
    Write-Host 'No changes to push.'
    exit 0
}

$msg = 'Update ERP project ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
git commit -m $msg
git push origin HEAD

Write-Host ('Pushed to ' + $RepoUrl + ' (ERP/)')
Set-Location $SourceDir
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
