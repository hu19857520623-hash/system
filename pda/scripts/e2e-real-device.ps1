param(
  [Parameter(Mandatory = $true)] [string] $ManifestPath,
  [ValidateSet('Inbound', 'Outbound', 'All')] [string] $Flow = 'All',
  [string] $AdbPath = $(if ($env:PDA_E2E_ADB) { $env:PDA_E2E_ADB } else { 'adb' }),
  [string] $Serial = $env:PDA_E2E_SERIAL,
  [string] $EvidenceDir = '',
  [string] $ApkPath = ''
)

$ErrorActionPreference = 'Stop'
$script:Package = 'com.takealot.pda'
$script:RemoteUi = '/sdcard/pda-e2e-window.xml'
$script:StepLog = [System.Collections.Generic.List[object]]::new()

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $AdbArgs)
  $prefix = if ($script:Serial) { @('-s', $script:Serial) } else { @() }
  $result = & $script:AdbPath @prefix @AdbArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($AdbArgs -join ' ') 失败：$($result -join ' ')"
  }
  return @($result)
}

function Add-Step {
  param([string] $Name, [string] $Detail)
  $script:StepLog.Add([ordered]@{
    at = (Get-Date).ToString('o')
    name = $Name
    detail = $Detail
  })
  Write-Host "[PDA] $Name - $Detail" -ForegroundColor Cyan
}

function Get-UiDocument {
  Invoke-Adb shell uiautomator dump $script:RemoteUi | Out-Null
  $raw = (Invoke-Adb exec-out cat $script:RemoteUi) -join "`n"
  $start = $raw.IndexOf('<?xml')
  if ($start -lt 0) { throw '无法读取 PDA UI 层级' }
  return [xml]$raw.Substring($start)
}

function Get-NodeText {
  param($Node)
  return "$(($Node.text)) $(($Node.'content-desc'))".Trim()
}

function Find-UiNode {
  param(
    [Parameter(Mandatory = $true)] [string] $Text,
    [switch] $Exact,
    [switch] $Editable
  )
  $doc = Get-UiDocument
  foreach ($node in @($doc.SelectNodes('//node'))) {
    $value = Get-NodeText $node
    $matches = if ($Exact) { $value -eq $Text } else { $value -like "*$Text*" }
    if ($matches -and (!$Editable -or "$($node.class)" -like '*EditText*')) { return $node }
  }
  return $null
}

function Find-UiNodes {
  param([string] $Text, [switch] $Editable)
  $doc = Get-UiDocument
  return @($doc.SelectNodes('//node')) | Where-Object {
    (Get-NodeText $_) -like "*$Text*" -and (!$Editable -or "$($_.class)" -like '*EditText*')
  }
}

function Wait-UiNode {
  param([string] $Text, [int] $TimeoutSeconds = 20, [switch] $Editable)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $node = Find-UiNode -Text $Text -Editable:$Editable
    if ($node) { return $node }
    Start-Sleep -Milliseconds 600
  } while ((Get-Date) -lt $deadline)
  throw "等待 PDA 页面文字超时：$Text"
}

function Get-NodeCenter {
  param($Node)
  $bounds = "$($Node.bounds)"
  if ($bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') {
    throw "控件 bounds 无效：$bounds"
  }
  return @(
    [int](($matches[1] + $matches[3]) / 2),
    [int](($matches[2] + $matches[4]) / 2)
  )
}

function Get-ClickableNode {
  param($Node)
  $current = $Node
  while ($current -and $current.Name -eq 'node') {
    if ("$($current.clickable)" -eq 'true') { return $current }
    $current = $current.ParentNode
  }
  return $Node
}

function Click-Node {
  param($Node)
  $point = Get-NodeCenter (Get-ClickableNode $Node)
  Invoke-Adb shell input tap "$($point[0])" "$($point[1])" | Out-Null
  Start-Sleep -Milliseconds 500
}

function Click-Text {
  param([string] $Text, [int] $ScrollAttempts = 5)
  for ($attempt = 0; $attempt -le $ScrollAttempts; $attempt++) {
    $node = Find-UiNode -Text $Text
    if ($node) { Click-Node $node; return }
    if ($attempt -lt $ScrollAttempts) {
      Invoke-Adb shell input swipe 500 1450 500 450 350 | Out-Null
      Start-Sleep -Milliseconds 400
    }
  }
  throw "PDA 页面未找到可点击文字：$Text"
}

function Send-Scan {
  param([string] $Code)
  if ([string]::IsNullOrWhiteSpace($Code)) { throw '扫码值不能为空' }
  Invoke-Adb shell am broadcast -a scanner.action.BARCODE -p $script:Package --es barcode $Code | Out-Null
  Start-Sleep -Milliseconds 900
}

function Set-FieldValue {
  param([string] $Label, [string] $Value, [int] $Occurrence = -1)
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
  $node = $null
  for ($attempt = 0; $attempt -le 5; $attempt++) {
    $matches = @(Find-UiNodes -Text $Label -Editable)
    if ($matches.Count) {
      $pick = if ($Occurrence -lt 0) { $matches.Count - 1 } else { [Math]::Min($Occurrence, $matches.Count - 1) }
      $node = $matches[$pick]
    }
    if (!$node) {
      $labelNode = Find-UiNode -Text $Label
      if ($labelNode) {
        $candidate = @($labelNode.ParentNode.SelectNodes('.//node')) |
          Where-Object { "$($_.class)" -like '*EditText*' } |
          Select-Object -First 1
        if ($candidate) { $node = $candidate }
      }
    }
    if ($node) { break }
    Invoke-Adb shell input swipe 500 1450 500 450 350 | Out-Null
    Start-Sleep -Milliseconds 400
  }
  if (!$node) { throw "未找到输入框：$Label" }
  Click-Node $node
  Invoke-Adb shell input keyevent KEYCODE_MOVE_END | Out-Null
  1..80 | ForEach-Object { Invoke-Adb shell input keyevent KEYCODE_DEL | Out-Null }
  Invoke-Adb shell input text $Value | Out-Null
  Start-Sleep -Milliseconds 350
}

function Save-Evidence {
  param([string] $Name)
  $safe = $Name -replace '[^A-Za-z0-9._-]', '_'
  $remote = "/sdcard/$safe.png"
  $localPng = Join-Path $script:EvidenceDir "$safe.png"
  $localXml = Join-Path $script:EvidenceDir "$safe.xml"
  Invoke-Adb shell screencap -p $remote | Out-Null
  Invoke-Adb pull $remote $localPng | Out-Null
  $doc = Get-UiDocument
  $doc.Save($localXml)
  Add-Step $Name "已保存截图与 UI 证据"
}

function Assert-Device {
  $rows = Invoke-Adb devices -l | Where-Object { $_ -match '\sdevice(?:\s|$)' }
  if ($script:Serial) {
    if (!($rows | Where-Object { $_ -match "^$([regex]::Escape($script:Serial))\s" })) {
      throw "未找到指定 PDA：$script:Serial"
    }
  } elseif (@($rows).Count -ne 1) {
    throw "必须且只能连接一台 PDA；当前 $(@($rows).Count) 台"
  } else {
    $script:Serial = (@($rows)[0] -split '\s+')[0]
  }
}

function Ensure-AppReady {
  if ($script:ApkPath) {
    $resolvedApk = (Resolve-Path -LiteralPath $script:ApkPath).Path
    Invoke-Adb install -r $resolvedApk | Out-Null
    Add-Step '安装 PDA' $resolvedApk
  }
  Invoke-Adb shell am force-stop $script:Package | Out-Null
  Invoke-Adb shell monkey -p $script:Package -c android.intent.category.LAUNCHER 1 | Out-Null
  Start-Sleep -Seconds 2
  $doc = Get-UiDocument
  $allText = (@($doc.SelectNodes('//node')) | ForEach-Object { Get-NodeText $_ }) -join ' '
  if ($allText -match '仓库 PDA|Warehouse PDA|Pakhuis PDA') {
    throw 'PDA 尚未登录。请先使用 ERP 仓库账号登录并选择作业仓库，再运行自动化脚本。'
  }
  if ($allText -notmatch '作业仓库|Working warehouse|Werksmagasyn') {
    throw 'PDA 未停留在首页，无法确认登录状态'
  }
  Add-Step 'PDA 会话' "设备 $script:Serial 已登录"
}

function Select-Warehouse {
  param([string] $WarehouseCode)
  if ([string]::IsNullOrWhiteSpace($WarehouseCode)) { throw 'manifest 缺少 warehouseCode' }
  if (Find-UiNode -Text $WarehouseCode) {
    Add-Step '作业仓库' $WarehouseCode
    return
  }
  $label = Find-UiNode -Text '作业仓库'
  if (!$label) { throw '首页未找到作业仓库选择器' }
  $doc = Get-UiDocument
  $warehouseValue = @($doc.SelectNodes('//node')) |
    Where-Object { (Get-NodeText $_) -match '\([A-Za-z0-9_-]+\)' } |
    Select-Object -First 1
  if (!$warehouseValue) { throw '无法定位当前作业仓库' }
  Click-Node $warehouseValue
  $target = Wait-UiNode -Text $WarehouseCode
  Click-Node $target
  Wait-UiNode -Text $WarehouseCode | Out-Null
  Add-Step '作业仓库' $WarehouseCode
}

function Go-Home {
  for ($i = 0; $i -lt 3; $i++) {
    if (Find-UiNode -Text '作业仓库') { return }
    Invoke-Adb shell input keyevent KEYCODE_BACK | Out-Null
    Start-Sleep -Milliseconds 700
  }
  throw '无法返回 PDA 首页'
}

function Run-Inbound {
  param($Inbound)
  if (!$Inbound -or [string]::IsNullOrWhiteSpace("$($Inbound.orderNo)")) {
    throw 'manifest 缺少 inbound.orderNo'
  }
  Go-Home
  Click-Text '到仓扫描'
  Send-Scan "$($Inbound.orderNo)"
  Wait-UiNode -Text "$($Inbound.orderNo)" | Out-Null
  Save-Evidence 'inbound-arrived'

  foreach ($cartonCode in @($Inbound.cartonCodes)) { Send-Scan "$cartonCode" }
  Click-Text '确认箱数'
  foreach ($item in @($Inbound.items)) {
    $qty = [Math]::Max(1, [int]$item.qty)
    for ($i = 0; $i -lt $qty; $i++) { Send-Scan "$($item.scanCode)" }
  }
  Save-Evidence 'inbound-counted'
  Click-Text '提交清点'
  Wait-UiNode -Text '下一步：进入上架扫描' | Out-Null
  Save-Evidence 'inbound-qc-submitted'

  Go-Home
  Click-Text '上架'
  Send-Scan "$($Inbound.orderNo)"
  Wait-UiNode -Text "$($Inbound.orderNo)" | Out-Null
  foreach ($item in @($Inbound.items)) {
    Send-Scan "$($item.scanCode)"
    Send-Scan "$($item.locationCode)"
    Click-Text '确认上架'
  }
  Wait-UiNode -Text '上架完成' -TimeoutSeconds 30 | Out-Null
  Save-Evidence 'inbound-putaway-completed'
}

function Run-Outbound {
  param($Outbound)
  if (!$Outbound -or [string]::IsNullOrWhiteSpace("$($Outbound.orderNo)")) {
    throw 'manifest 缺少 outbound.orderNo'
  }
  Go-Home
  Click-Text '拣货'
  Send-Scan "$($Outbound.orderNo)"
  Wait-UiNode -Text "$($Outbound.orderNo)" | Out-Null
  foreach ($allocation in @($Outbound.allocations)) {
    Send-Scan "$($allocation.locationCode)"
    Send-Scan "$($allocation.scanCode)"
  }
  Save-Evidence 'outbound-picked-scans'
  Click-Text '提交拣货'
  Wait-UiNode -Text '拣货完成' -TimeoutSeconds 30 | Out-Null

  Go-Home
  Click-Text '复核'
  Send-Scan "$($Outbound.orderNo)"
  Wait-UiNode -Text "$($Outbound.orderNo)" | Out-Null
  if (Find-UiNode -Text '开始复核') { Click-Text '开始复核' }
  foreach ($item in @($Outbound.items)) {
    $qty = [Math]::Max(1, [int]$item.qty)
    for ($i = 0; $i -lt $qty; $i++) { Send-Scan "$($item.scanCode)" }
  }
  foreach ($carton in @($Outbound.cartons)) {
    $index = [array]::IndexOf(@($Outbound.cartons), $carton)
    if ($index -gt 0) { Click-Text '+ 新增箱' }
    Set-FieldValue '长(cm)' "$($carton.lengthCm)" -Occurrence -1
    Set-FieldValue '宽(cm)' "$($carton.widthCm)" -Occurrence -1
    Set-FieldValue '高(cm)' "$($carton.heightCm)" -Occurrence -1
    Set-FieldValue '毛重(kg)' "$($carton.grossWeightKg)" -Occurrence -1
  }
  Save-Evidence 'outbound-reviewed-measured'
  Click-Text '提交复核并计算费用'
  Wait-UiNode -Text '实际费用已回写' -TimeoutSeconds 30 | Out-Null

  Go-Home
  Click-Text '发运'
  Send-Scan "$($Outbound.orderNo)"
  Wait-UiNode -Text "$($Outbound.orderNo)" | Out-Null
  Set-FieldValue '跟踪号' "$($Outbound.trackingNo)"
  Set-FieldValue '承运商' "$($Outbound.carrier)"
  Set-FieldValue '物流产品' "$($Outbound.logisticsProduct)"
  Save-Evidence 'outbound-ready-to-ship'
  Click-Text '确认发运'
  Wait-UiNode -Text '实际费用已同步' -TimeoutSeconds 30 | Out-Null
  Save-Evidence 'outbound-shipped'
}

$script:AdbPath = (Get-Command $AdbPath -ErrorAction Stop).Source
$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
if (!$EvidenceDir) {
  $EvidenceDir = Join-Path (Split-Path -Parent $resolvedManifest) ("pda-evidence-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$script:EvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory -Path $script:EvidenceDir -Force | Out-Null

try {
  Assert-Device
  Ensure-AppReady
  Select-Warehouse "$($manifest.warehouseCode)"
  if ($Flow -in @('Inbound', 'All')) { Run-Inbound $manifest.inbound }
  if ($Flow -in @('Outbound', 'All')) { Run-Outbound $manifest.outbound }
  Add-Step '完成' "$Flow PDA 实单流程通过"
  [ordered]@{
    ok = $true
    flow = $Flow
    device = $script:Serial
    manifest = $resolvedManifest
    evidenceDir = $script:EvidenceDir
    steps = $script:StepLog
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:EvidenceDir 'result.json') -Encoding utf8
} catch {
  $message = $_.Exception.Message
  Add-Step '失败' $message
  [ordered]@{
    ok = $false
    flow = $Flow
    device = $script:Serial
    manifest = $resolvedManifest
    evidenceDir = $script:EvidenceDir
    error = $message
    steps = $script:StepLog
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:EvidenceDir 'result.json') -Encoding utf8
  throw
}
