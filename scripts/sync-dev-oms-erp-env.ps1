# 本地开发：保证 ERP backend 与 OMS 使用相同的 OMS_INTERNAL_TOKEN / ERP_API_BASE
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$devToken = 'local-dev-oms-internal-token-32chars-min!!'

function Ensure-EnvFile([string]$path, [string]$examplePath) {
  if (-not (Test-Path $path)) {
    if (Test-Path $examplePath) {
      Copy-Item $examplePath $path
    } else {
      New-Item -ItemType File -Path $path -Force | Out-Null
    }
  }
}

function Set-EnvKey([string]$path, [string]$key, [string]$value) {
  $lines = @(Get-Content $path -ErrorAction SilentlyContinue)
  $pattern = "^\s*$([regex]::Escape($key))\s*="
  $newLine = "$key=`"$value`""
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $found = $true
      $current = $line -replace '^\s*[^=]+=\s*', ''
      $current = $current.Trim().Trim('"').Trim("'")
      if (
        -not $current
        -or $current -match '请替换'
        -or $current -match '^replace-with'
      ) {
        $newLine
      } else {
        $line
      }
    } else {
      $line
    }
  }
  if (-not $found) {
    $out += $newLine
  }
  Set-Content -Path $path -Value $out -Encoding utf8
}

$erpEnv = Join-Path $root 'erp\backend\.env'
$erpExample = Join-Path $root 'erp\backend\.env.example'
$omsEnv = Join-Path $root 'oms\.env'
$omsExample = Join-Path $root 'oms\.env.example'

Ensure-EnvFile $erpEnv $erpExample
Ensure-EnvFile $omsEnv $omsExample

Set-EnvKey $erpEnv 'OMS_INTERNAL_TOKEN' $devToken
Set-EnvKey $omsEnv 'OMS_INTERNAL_TOKEN' $devToken
Set-EnvKey $omsEnv 'ERP_API_BASE' 'http://127.0.0.1:3000/api'

Write-Host "已对齐本地 OMS_INTERNAL_TOKEN（ERP backend + OMS）。" -ForegroundColor Green
