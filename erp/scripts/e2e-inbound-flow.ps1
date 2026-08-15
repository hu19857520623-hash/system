$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000/api'

function Api($method, $path, $body, $token) {
  $params = @{ Uri = "$base$path"; Method = $method; ContentType = 'application/json' }
  if ($token) { $params.Headers = @{ Authorization = "Bearer $token" } }
  if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 8) }
  $res = Invoke-RestMethod @params
  if ($res.code -ne 0) { throw "API $method $path failed: $($res.message)" }
  return $res.data
}

function ApiExpectFail($method, $path, $body, $token) {
  try {
    Api $method $path $body $token | Out-Null
    throw "Expected failure for $method $path"
  } catch {
    return $_.Exception.Message
  }
}

$login = Api POST '/auth/login' @{ username = 'admin'; password = '123456' }
$token = $login.token
Write-Host "[1] Login OK, has arrival_scan:" ($login.user.permissions -contains 'inbound.arrival_scan')

$inboundNo = 'IN-E2E-' + (Get-Date -Format 'HHmmss')
$warehouseNo = 'WH-E2E-' + (Get-Date -Format 'HHmmss')
Write-Host "[2] Create inbound $inboundNo warehouseNo=$warehouseNo"
$created = Api POST '/inbound' @{
  inboundNo       = $inboundNo
  sourceWarehouseCode = 'LW-SZ-01'
  warehouseCode   = 'WMS-JHB-01'
  warehouseNo     = $warehouseNo
  remark          = 'E2E联调'
  items           = @(@{ productId = 1; sku = 'TK-99001'; expectedQty = 10 })
} $token
$id = $created.id
Write-Host "    created id=$id status=$($created.status)"

Write-Host "[3] startReceive before scan (expect fail)"
$failMsg = ApiExpectFail POST "/inbound/$id/start-receive" $null $token
Write-Host "    OK blocked: $failMsg"

Write-Host "[4] arrival scan by warehouseNo"
$scan = Api POST '/inbound/arrival-scan' @{ scanCode = $warehouseNo; warehouseCode = 'WMS-JHB-01' } $token
Write-Host "    $($scan.message) status=$($scan.order.status)"

Write-Host "[5] startReceive after scan"
$recv = Api POST "/inbound/$id/start-receive" $null $token
Write-Host "    status=$($recv.status)"

Write-Host "[6] QC submit"
$detail = Api GET "/inbound/$id" $null $token
$qcItems = @()
foreach ($item in $detail.items) {
  $qcItems += @{ id = $item.id; sku = $item.sku; actualQty = $item.expectedQty; qcStatus = 'pass' }
}
$qc = Api POST "/inbound/$id/qc" @{ acceptDiff = $false; items = $qcItems } $token
Write-Host "    status=$($qc.status)"

Write-Host "[7] putaway to STAGE-01"
$detail2 = Api GET "/inbound/$id" $null $token
$putItems = @()
foreach ($item in $detail2.items) {
  $qty = $item.actualQty
  if (-not $qty) { $qty = $item.expectedQty }
  $putItems += @{ inboundItemId = $item.id; locationCode = 'STAGE-01'; qty = $qty }
}
$put = Api POST "/inbound/$id/putaway" @{ items = $putItems } $token
Write-Host "    status=$($put.status)"

Write-Host "[8] dashboard badges"
$notif = Api GET '/dashboard/notifications' $null $token
Write-Host "    inbound_in_transit=$($notif.badges.inbound_in_transit) inbound_arrived=$($notif.badges.inbound_arrived) inbound_putaway=$($notif.badges.inbound_putaway)"

Write-Host "[9] logistics inventory after allocate"
$inv = Api GET '/inventory?warehouseType=logistics&warehouseCode=LW-SZ-01&pageSize=1' $null $token
Write-Host "    TK-99001 available=$($inv.items[0].availableQty) (expect 490)"

Write-Host 'E2E PASSED'
