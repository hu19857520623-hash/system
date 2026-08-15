# Full E2E: Create SKU -> PO -> logistics receive -> inbound -> arrival scan -> receive -> putaway
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000/api'
$ts = Get-Date -Format 'yyyyMMddHHmmss'

function Api($method, $path, $body, $token) {
  $params = @{ Uri = "$base$path"; Method = $method; ContentType = 'application/json' }
  if ($token) { $params.Headers = @{ Authorization = "Bearer $token" } }
  if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 10) }
  try {
    $res = Invoke-RestMethod @params
  } catch {
    $err = $_.ErrorDetails.Message
    if ($err) {
      try { $j = $err | ConvertFrom-Json; throw "API $method $path : $($j.message)" } catch { throw "API $method $path : $err" }
    }
    throw $_
  }
  if ($res.code -ne 0) { throw "API $method $path failed: $($res.message)" }
  return $res.data
}

function ApiExpectFail($method, $path, $body, $token) {
  try {
    Api $method $path $body $token | Out-Null
    throw "Expected failure: $method $path"
  } catch {
    return ($_.Exception.Message -replace '^API [^:]+ : ', '')
  }
}

function Step($n, $msg) { Write-Host ""; Write-Host "[$n] $msg" -ForegroundColor Cyan }

Step 0 'Login'
$login = Api POST '/auth/login' @{ username = 'admin'; password = '123456' }
$token = $login.token
Write-Host '    OK admin'

Step 1 'Create SKU'
$sku = "E2E-$ts"
$product = Api POST '/products' @{
  sku         = $sku
  productName = "E2E Product $ts"
  spec        = 'test'
  category    = 'test'
  lengthCm    = 20
  widthCm     = 15
  heightCm    = 10
  weightKg    = 0.5
  costRmb     = 12.5
  status      = 'active'
} $token
$productId = $product.id
Write-Host "    SKU=$sku productId=$productId"

Step 2 'Create PO'
$suppliers = Api GET '/suppliers?pageSize=1' $null $token
$supplierId = $suppliers.items[0].id
if (-not $supplierId) { throw 'No supplier found' }
$poQty = 20
$po = Api POST '/purchase-orders' @{
  supplierId    = $supplierId
  warehouseCode = 'LW-SZ-01'
  remark        = "E2E full flow $ts"
  items         = @(@{
    productId   = $productId
    sku         = $sku
    productName = $product.productName
    quantity    = $poQty
    unitPrice   = 12.5
  })
} $token
$poId = $po.id
Write-Host "    PO=$($po.poNo) id=$poId status=$($po.status)"

Step 3 'PO + finance audit'
$po = Api POST "/purchase-orders/$poId/approve" @{ remark = 'E2E PO approved' } $token
Write-Host "    PO audit -> $($po.status)"
$po = Api POST "/purchase-orders/$poId/finance-approve" @{ remark = 'E2E finance approved' } $token
Write-Host "    finance -> $($po.status)"

Step 4 'Logistics receive'
$poItemId = $po.items[0].id
$lr = Api POST '/logistics-receipts' @{
  poId          = $poId
  warehouseCode = 'LW-SZ-01'
  remark        = 'E2E logistics receive'
  items         = @(@{
    poItemId   = $poItemId
    sku        = $sku
    actualQty  = $poQty
    damagedQty = 0
    qcStatus   = 'pass'
  })
} $token
Write-Host "    receipt=$($lr.receiptNo)"

Step 5 'Check logistics inventory'
$logInv = Api GET "/inventory?warehouseType=logistics&warehouseCode=LW-SZ-01&keyword=$sku" $null $token
$logAvail = ($logInv.items | Where-Object { $_.sku -eq $sku } | Select-Object -First 1).availableQty
Write-Host "    logistics available=$logAvail expect>=$poQty"
if ($logAvail -lt $poQty) { throw "Logistics inventory insufficient" }

Step 6 'Create inbound'
$inboundNo = "IN-E2E-$ts"
$warehouseNo = "WH-E2E-$ts"
$shipQty = 15
$inbound = Api POST '/inbound' @{
  inboundNo           = $inboundNo
  poId                = $poId
  sourceWarehouseCode = 'LW-SZ-01'
  warehouseCode       = 'WMS-JHB-01'
  warehouseNo         = $warehouseNo
  remark              = 'E2E ship'
  items               = @(@{ productId = $productId; sku = $sku; expectedQty = $shipQty })
} $token
$inboundId = $inbound.id
Write-Host "    inbound=$inboundNo id=$inboundId status=$($inbound.status)"

$logInv2 = Api GET "/inventory?warehouseType=logistics&warehouseCode=LW-SZ-01&keyword=$sku" $null $token
$logAvail2 = ($logInv2.items | Where-Object { $_.sku -eq $sku } | Select-Object -First 1).availableQty
Write-Host "    logistics after ship=$logAvail2 expect=$($logAvail - $shipQty)"

Step 7 'Block receive before scan'
$fail = ApiExpectFail POST "/inbound/$inboundId/start-receive" $null $token
Write-Host "    blocked: $fail"

Step 8 'Arrival scan'
$scan = Api POST '/inbound/arrival-scan' @{ scanCode = $warehouseNo; warehouseCode = 'WMS-JHB-01' } $token
Write-Host "    $($scan.message) status=$($scan.order.status)"

Step 9 'Receive + QC'
$recv = Api POST "/inbound/$inboundId/start-receive" $null $token
Write-Host "    receive -> $($recv.status)"
$detail = Api GET "/inbound/$inboundId" $null $token
$qcItems = @()
foreach ($item in $detail.items) {
  $qcItems += @{ id = $item.id; sku = $item.sku; actualQty = $item.expectedQty; qcStatus = 'pass' }
}
$qc = Api POST "/inbound/$inboundId/qc" @{ acceptDiff = $false; items = $qcItems } $token
Write-Host "    QC -> $($qc.status)"

Step 10 'Putaway'
$detail2 = Api GET "/inbound/$inboundId" $null $token
$putItems = @()
foreach ($item in $detail2.items) {
  $qty = $item.actualQty
  if (-not $qty) { $qty = $item.expectedQty }
  $putItems += @{ inboundItemId = $item.id; locationCode = 'STAGE-01'; qty = $qty }
}
$put = Api POST "/inbound/$inboundId/putaway" @{ items = $putItems } $token
Write-Host "    putaway -> $($put.status)"

Step 11 'Check WMS inventory'
$wmsInv = Api GET "/inventory?warehouseCode=WMS-JHB-01&keyword=$sku" $null $token
$wmsQty = ($wmsInv.items | Where-Object { $_.sku -eq $sku } | Select-Object -First 1).availableQty
Write-Host "    WMS available=$wmsQty expect=$shipQty"
if ($wmsQty -ne $shipQty) { throw "WMS inventory mismatch" }

Step 12 'Dashboard badges'
$notif = Api GET '/dashboard/notifications' $null $token
Write-Host "    in_transit=$($notif.badges.inbound_in_transit) arrived=$($notif.badges.inbound_arrived)"

Write-Host ''
Write-Host 'FULL E2E PASSED' -ForegroundColor Green
Write-Host "SKU=$sku PO=$($po.poNo) IN=$inboundNo WH=$warehouseNo"
