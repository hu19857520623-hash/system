/**
 * Read-only completion audit for the three real ERP / OMS / PDA flows.
 *
 * This script never creates orders or inventory. It accepts only explicit real
 * business identifiers and evidence files, then proves the resulting records
 * reached their required terminal states in production.
 */
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { mapCsvRows, parseCsv, readImportFileText } from '../src/data/csvImportExport'
import { PRODUCT_COLUMNS, parseProducts } from '../src/data/importTemplates'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotIdentityConflicts,
  takealotMissingFields,
} from '../src/data/takealotDocParser'
import { extractPdfTextModelFromData } from '../src/data/takealotPdfText'

type Json = Record<string, any>
type Check = { name: string; ok: boolean; detail: string }

type FlowEvidence = {
  outboundNo: string
  pdaResult: string
  podFile: string
}

type Manifest = {
  evidenceOutput?: string
  erp: {
    productDevId: number
    purchaseOrderId: number
    inboundId: number
    outboundId: number
    productSku: string
    productImageFile: string
    pdaResult: string
  }
  catalog: FlowEvidence & {
    customerCode: string
    purchaseNo: string
    shipmentFiles: string[]
  }
  ecommerce: FlowEvidence & {
    customerCode: string
    xlsxFile: string
    xlsxProductSkus: string[]
    manualProductSku: string
    manualProductImageFile: string
    inboundNo: string
    shipmentFiles: string[]
  }
}

const manifestArg = process.argv[2]
if (!manifestArg) throw new Error('用法：npm run e2e:real:evidence -- <真实验收 manifest.json>')

const manifestPath = resolve(manifestArg)
const manifestDir = dirname(manifestPath)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
const checks: Check[] = []

const requiredSetting = (name: string) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

const ERP_BASE = requiredSetting('ERP_E2E_BASE').replace(/\/$/, '')
const OMS_BASE = requiredSetting('OMS_E2E_BASE').replace(/\/$/, '').replace(/\/api$/, '')

function localPath(value: string) {
  return isAbsolute(value) ? value : resolve(manifestDir, value)
}

function endpoint(base: string, path: string) {
  if (base.endsWith('/api') && path.startsWith('/api/')) return `${base}${path.slice(4)}`
  return `${base}${path}`
}

function add(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

function requireBusinessValue(name: string, value: unknown) {
  const text = String(value ?? '').trim()
  const placeholder = /^(REAL-|YOUR-|TODO|EXAMPLE|PLACEHOLDER|E2E(?:LBL)?[-_])/i.test(text)
  add(name, Boolean(text) && !placeholder, placeholder ? `拒绝占位/演示值：${text}` : text || '为空')
}

async function jsonRequest(base: string, path: string, token: string) {
  const response = await fetch(endpoint(base, path), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({})) as Json
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}：${payload.message || payload.error || '请求失败'}`)
  if ('code' in payload) {
    if (payload.code !== 0) throw new Error(`${path}：${payload.message || '业务失败'}`)
    return payload.data as Json
  }
  return payload
}

async function loginErp() {
  const response = await fetch(endpoint(ERP_BASE, '/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: requiredSetting('ERP_E2E_USERNAME'),
      password: requiredSetting('ERP_E2E_PASSWORD'),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({})) as Json
  const token = payload?.data?.token
  if (!response.ok || payload.code !== 0 || !token) throw new Error(`ERP 登录失败：HTTP ${response.status}`)
  return String(token)
}

async function loginOms(prefix: 'CATALOG' | 'ECOMMERCE') {
  const response = await fetch(`${OMS_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: requiredSetting(`OMS_E2E_${prefix}_USERNAME`),
      password: requiredSetting(`OMS_E2E_${prefix}_PASSWORD`),
      remember: false,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({})) as Json
  if (!response.ok || !payload.token) throw new Error(`OMS ${prefix} 登录失败：HTTP ${response.status}`)
  if (payload.user?.mustChangePassword) throw new Error(`OMS ${prefix} 账号仍要求修改临时密码`)
  return { token: String(payload.token), user: payload.user as Json }
}

async function fileCheck(name: string, value: string, allowed: string[]) {
  const path = localPath(value)
  try {
    const info = await stat(path)
    const bytes = await readFile(path)
    const ext = basename(path).split('.').pop()?.toLowerCase() || ''
    const signatureOk = ext === 'pdf'
      ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      : ext === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : ['jpg', 'jpeg'].includes(ext)
          ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          : ext === 'xlsx'
            ? bytes[0] === 0x50 && bytes[1] === 0x4b
            : true
    add(name, info.isFile() && info.size > 0 && allowed.includes(ext) && signatureOk,
      `${basename(path)} · ${info.size} bytes`)
    return path
  } catch (error) {
    add(name, false, `不可读：${(error as Error).message}`)
    return path
  }
}

async function verifyWorkbook(pathValue: string, expectedSkus: string[]) {
  const path = await fileCheck('电商 XLSX 原始文件', pathValue, ['xlsx'])
  try {
    const bytes = await readFile(path)
    const result = await readImportFileText(new File([bytes], basename(path)), PRODUCT_COLUMNS)
    const mapped = mapCsvRows(parseCsv(result.text), PRODUCT_COLUMNS, result.lineOffset)
    const parsed = parseProducts(mapped.records)
    const errors = [...mapped.errors, ...parsed.errors]
    const actual = new Set(parsed.data.map(item => item.customerSku || item.internalSku))
    const missing = expectedSkus.filter(sku => !actual.has(sku))
    add('电商 XLSX 可导入且包含验收 SKU', parsed.data.length > 0 && errors.length === 0 && missing.length === 0,
      `合格 ${parsed.data.length} 条，错误 ${errors.length} 条，缺少 ${missing.join('、') || '无'}`)
  } catch (error) {
    add('电商 XLSX 可导入且包含验收 SKU', false, (error as Error).message)
  }
}

async function verifyShipmentSet(name: string, values: string[]) {
  if (values.length !== 4) return undefined
  const expected = ['外箱标', '预约单', '发货清单', 'SKU 标签']
  try {
    const parts = []
    for (const [index, value] of values.entries()) {
      const path = localPath(value)
      const bytes = await readFile(path)
      const model = await extractPdfTextModelFromData(new Uint8Array(bytes))
      const kind = detectTakealotDocKind(basename(path), model.text)
      if (kind !== expected[index]) {
        add(`${name}文件类型`, false, `${basename(path)} 识别为“${kind}”，应为“${expected[index]}”`)
        return undefined
      }
      parts.push(mergeTakealotParsed(
        parseTakealotFilename(basename(path)),
        parseTakealotDocumentText(model.text, kind),
      ))
    }
    const conflicts = takealotIdentityConflicts(parts)
    const merged = mergeTakealotParsed(...parts)
    const missing = takealotMissingFields(merged)
    const ok = conflicts.length === 0 && missing.length === 0
    add(`${name}四份文件业务身份一致且完整`, ok,
      ok
        ? `预约 ${merged.bookingRef}；PO ${merged.poNumber}；卖家 ${merged.sellerId}；仓 ${merged.warehouseCode}`
        : [...conflicts, ...missing.map(field => `缺少 ${field}`)].join('；'))
    return ok ? merged : undefined
  } catch (error) {
    add(`${name}四份文件业务身份一致且完整`, false, (error as Error).message)
    return undefined
  }
}

async function verifyPda(name: string, resultValue: string, requiredStages: string[]) {
  const path = localPath(resultValue)
  try {
    const payload = JSON.parse(await readFile(path, 'utf8')) as Json
    const stages = new Set((payload.steps || []).map((step: Json) => String(step.name)))
    const missing = requiredStages.filter(stage => !stages.has(stage))
    let evidenceMissing = 0
    for (const stage of requiredStages.filter(stage => stage !== '完成')) {
      const safe = stage.replace(/[^A-Za-z0-9._-]/g, '_')
      const evidenceDir = String(payload.evidenceDir || dirname(path))
      const candidates = [join(evidenceDir, `${safe}.png`), join(evidenceDir, `${safe}.xml`)]
      for (const candidate of candidates) {
        try { if (!(await stat(candidate)).isFile()) evidenceMissing += 1 } catch { evidenceMissing += 1 }
      }
    }
    add(name, payload.ok === true && missing.length === 0 && evidenceMissing === 0,
      `设备 ${payload.device || '未知'}；缺少阶段 ${missing.join('、') || '无'}；缺少证据文件 ${evidenceMissing}`)
  } catch (error) {
    add(name, false, `PDA 结果不可用：${(error as Error).message}`)
  }
}

function imagePresent(product: Json) {
  return Boolean(String(product.image || product.imageUrl || '').trim())
}

function skuMatches(product: Json, sku: string) {
  const values = [product.customerSku, product.internalSku, product.sku].map(value => String(value || '').toLowerCase())
  const target = sku.toLowerCase()
  return values.includes(target) || values.some(value => value.endsWith(`-${target}`))
}

async function verifyPod(name: string, token: string, customerCode: string, outboundNo: string, sourceValue: string) {
  const sourcePath = await fileCheck(`${name} POD 原始文件`, sourceValue, ['pdf', 'png', 'jpg', 'jpeg'])
  try {
    const response = await fetch(`${OMS_BASE}/api/erp/outbound/${encodeURIComponent(outboundNo)}/pod?customerCode=${encodeURIComponent(customerCode)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    const downloaded = Buffer.from(await response.arrayBuffer())
    const source = await readFile(sourcePath)
    add(`${name} POD 已回传 ERP 且可下载`, response.ok && downloaded.length > 0 && downloaded.equals(source),
      `HTTP ${response.status}；ERP ${downloaded.length} bytes；原文件 ${source.length} bytes`)
  } catch (error) {
    add(`${name} POD 已回传 ERP 且可下载`, false, (error as Error).message)
  }
}

requireBusinessValue('ERP 商品 SKU', manifest.erp.productSku)
requireBusinessValue('货盘采购单号', manifest.catalog.purchaseNo)
requireBusinessValue('货盘出库单号', manifest.catalog.outboundNo)
requireBusinessValue('电商入库单号', manifest.ecommerce.inboundNo)
requireBusinessValue('电商出库单号', manifest.ecommerce.outboundNo)
for (const sku of manifest.ecommerce.xlsxProductSkus || []) requireBusinessValue(`XLSX SKU ${sku}`, sku)
requireBusinessValue('手工录入 SKU', manifest.ecommerce.manualProductSku)

await fileCheck('ERP 选品商品图片', manifest.erp.productImageFile, ['png', 'jpg', 'jpeg'])
await fileCheck('电商手工商品图片', manifest.ecommerce.manualProductImageFile, ['png', 'jpg', 'jpeg'])
for (const [index, file] of manifest.catalog.shipmentFiles.entries()) {
  await fileCheck(`货盘发货文件 ${index + 1}`, file, ['pdf'])
}
for (const [index, file] of manifest.ecommerce.shipmentFiles.entries()) {
  await fileCheck(`电商发货文件 ${index + 1}`, file, ['pdf'])
}
add('货盘四份发货文件齐全', manifest.catalog.shipmentFiles.length === 4, `共 ${manifest.catalog.shipmentFiles.length} 份`)
add('电商四份发货文件齐全', manifest.ecommerce.shipmentFiles.length === 4, `共 ${manifest.ecommerce.shipmentFiles.length} 份`)
const catalogShipment = await verifyShipmentSet('货盘', manifest.catalog.shipmentFiles)
const ecommerceShipment = await verifyShipmentSet('电商', manifest.ecommerce.shipmentFiles)
add('货盘与电商使用不同真实预约', Boolean(
  catalogShipment?.bookingRef
  && ecommerceShipment?.bookingRef
  && catalogShipment.bookingRef !== ecommerceShipment.bookingRef,
), `${catalogShipment?.bookingRef || '未知'} / ${ecommerceShipment?.bookingRef || '未知'}`)
await verifyWorkbook(manifest.ecommerce.xlsxFile, manifest.ecommerce.xlsxProductSkus)

const [erpToken, catalogSession, ecommerceSession] = await Promise.all([
  loginErp(),
  loginOms('CATALOG'),
  loginOms('ECOMMERCE'),
])
add('货盘账号与 manifest 客户一致', catalogSession.user.customerCode === manifest.catalog.customerCode,
  `${catalogSession.user.customerCode || '未知'} / ${manifest.catalog.customerCode}`)
add('货盘账号类型正确', catalogSession.user.role === 'catalog' && catalogSession.user.type === 'catalog',
  `role=${catalogSession.user.role || '未知'}；type=${catalogSession.user.type || '未知'}`)
add('电商账号与 manifest 客户一致', ecommerceSession.user.customerCode === manifest.ecommerce.customerCode,
  `${ecommerceSession.user.customerCode || '未知'} / ${manifest.ecommerce.customerCode}`)
add('电商账号类型正确', ecommerceSession.user.role === 'ecommerce' && ecommerceSession.user.type === 'ecommerce',
  `role=${ecommerceSession.user.role || '未知'}；type=${ecommerceSession.user.type || '未知'}`)

try {
  const productDev = await jsonRequest(ERP_BASE, `/product-dev/${manifest.erp.productDevId}`, erpToken)
  add('ERP 选品开发已审核通过', productDev.status === 'approved', `状态 ${productDev.status || '未知'}`)
  add('ERP 选品开发保留真实图片', Boolean(productDev.takealotPriceImageUrl || productDev.alibaba1688ImageUrl),
    productDev.takealotPriceImageUrl || productDev.alibaba1688ImageUrl || '无图片')
  add('ERP 选品 SKU 一致', String(productDev.sku || '') === manifest.erp.productSku,
    `${productDev.sku || '未知'} / ${manifest.erp.productSku}`)
} catch (error) { add('ERP 选品开发记录', false, (error as Error).message) }

try {
  const purchase = await jsonRequest(ERP_BASE, `/purchase-orders/${manifest.erp.purchaseOrderId}`, erpToken)
  const statusOk = ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved'].includes(String(purchase.status))
  const financial = Number(purchase.totalAmount) > 0 && Array.isArray(purchase.items) && purchase.items.some((item: Json) => Number(item.unitPrice) > 0)
  add('ERP 采购单已审核并进入可执行状态', statusOk, `状态 ${purchase.status || '未知'}`)
  add('ERP 采购财务字段真实返回', financial, `总额 ${purchase.totalAmount ?? '无'}；付款 ${purchase.paymentStatus ?? '无'}`)
} catch (error) { add('ERP 采购单记录', false, (error as Error).message) }

try {
  const inbound = await jsonRequest(ERP_BASE, `/inbound/${manifest.erp.inboundId}`, erpToken)
  add('ERP 自营入库已 PDA 上架完成', ['completed', 'confirmed'].includes(String(inbound.status)), `状态 ${inbound.status || '未知'}`)
  add('ERP 自营入库数量真实返回', Number(inbound.totalReceivedQty) > 0, `实收 ${inbound.totalReceivedQty ?? '无'}`)
} catch (error) { add('ERP 自营入库记录', false, (error as Error).message) }

try {
  const outbound = await jsonRequest(ERP_BASE, `/outbound/${manifest.erp.outboundId}`, erpToken)
  add('ERP 自营出库已 PDA 发运', ['shipped', 'delivered', 'partial_delivered'].includes(String(outbound.status)), `状态 ${outbound.status || '未知'}`)
  add('ERP 自营出库实测与费用已回写', Number(outbound.measure?.totalWeightKg) > 0 && Number.isFinite(Number(outbound.actualFees?.actualTotal)),
    `实重 ${outbound.measure?.totalWeightKg ?? '无'}；实收费用 ${outbound.actualFees?.actualTotal ?? '无'}`)
} catch (error) { add('ERP 自营出库记录', false, (error as Error).message) }

const catalogBootstrap = await jsonRequest(OMS_BASE, '/api/bootstrap', catalogSession.token)
const catalogPurchase = (catalogBootstrap.purchases || []).find((item: Json) => item.purchaseNo === manifest.catalog.purchaseNo)
add('OMS 货盘真实采购记录存在', Boolean(catalogPurchase), catalogPurchase ? `${catalogPurchase.sku} × ${catalogPurchase.qty}` : '未找到')
add('OMS 货盘采购数量有效', Number(catalogPurchase?.qty) > 0, `数量 ${catalogPurchase?.qty ?? '无'}`)

let catalogOutbound: Json = {}
try { catalogOutbound = await jsonRequest(OMS_BASE, `/api/erp/outbound/${encodeURIComponent(manifest.catalog.outboundNo)}`, catalogSession.token) }
catch (error) { add('OMS 货盘出库记录', false, (error as Error).message) }
add('OMS 货盘出库已由 ERP PDA 发运', ['shipped', 'delivered', 'partial_delivered'].includes(String(catalogOutbound.status)),
  `状态 ${catalogOutbound.status || '未知'}`)
add('OMS 货盘出库财务字段已返回', Number.isFinite(Number(catalogOutbound.actualFees?.actualTotal)) && Number(catalogOutbound.measure?.totalWeightKg) > 0,
  `实重 ${catalogOutbound.measure?.totalWeightKg ?? '无'}；费用 ${catalogOutbound.actualFees?.actualTotal ?? '无'}`)

const ecommerceBootstrap = await jsonRequest(OMS_BASE, '/api/bootstrap', ecommerceSession.token)
for (const sku of manifest.ecommerce.xlsxProductSkus) {
  const product = (ecommerceBootstrap.products || []).find((item: Json) => skuMatches(item, sku))
  add(`XLSX 商品 ${sku} 已进入 OMS`, Boolean(product), product?.internalSku || '未找到')
  add(`XLSX 商品 ${sku} 来源与图片可追溯`, product?.productSource === 'import' && imagePresent(product),
    `来源 ${product?.productSource || '无'}；图片 ${imagePresent(product) ? '有' : '无'}`)
}
const manualProduct = (ecommerceBootstrap.products || []).find((item: Json) => skuMatches(item, manifest.ecommerce.manualProductSku))
add('逐条手工商品已进入 OMS', Boolean(manualProduct), manualProduct?.internalSku || '未找到')
add('逐条手工商品来源与图片可追溯', manualProduct?.productSource === 'manual' && imagePresent(manualProduct),
  `来源 ${manualProduct?.productSource || '无'}；图片 ${imagePresent(manualProduct) ? '有' : '无'}`)

let ecommerceInbound: Json = {}
try { ecommerceInbound = await jsonRequest(OMS_BASE, `/api/erp/inbound/${encodeURIComponent(manifest.ecommerce.inboundNo)}`, ecommerceSession.token) }
catch (error) { add('OMS 电商入库记录', false, (error as Error).message) }
add('电商入库已由 ERP PDA 上架完成', ['completed', 'confirmed'].includes(String(ecommerceInbound.status)),
  `状态 ${ecommerceInbound.status || '未知'}`)

let ecommerceOutbound: Json = {}
try { ecommerceOutbound = await jsonRequest(OMS_BASE, `/api/erp/outbound/${encodeURIComponent(manifest.ecommerce.outboundNo)}`, ecommerceSession.token) }
catch (error) { add('OMS 电商出库记录', false, (error as Error).message) }
add('电商 OMS 出库已由 ERP PDA 发运', ['shipped', 'delivered', 'partial_delivered'].includes(String(ecommerceOutbound.status)),
  `状态 ${ecommerceOutbound.status || '未知'}`)
add('电商出库财务字段已返回', Number.isFinite(Number(ecommerceOutbound.actualFees?.actualTotal)) && Number(ecommerceOutbound.measure?.totalWeightKg) > 0,
  `实重 ${ecommerceOutbound.measure?.totalWeightKg ?? '无'}；费用 ${ecommerceOutbound.actualFees?.actualTotal ?? '无'}`)

await verifyPda('ERP 自营 PDA 入库与出库证据', manifest.erp.pdaResult, [
  'inbound-arrived', 'inbound-counted', 'inbound-qc-submitted', 'inbound-putaway-completed',
  'outbound-picked-scans', 'outbound-reviewed-measured', 'outbound-ready-to-ship', 'outbound-shipped', '完成',
])
await verifyPda('货盘 PDA 出库证据', manifest.catalog.pdaResult, [
  'outbound-picked-scans', 'outbound-reviewed-measured', 'outbound-ready-to-ship', 'outbound-shipped', '完成',
])
await verifyPda('电商 PDA 入库与出库证据', manifest.ecommerce.pdaResult, [
  'inbound-arrived', 'inbound-counted', 'inbound-qc-submitted', 'inbound-putaway-completed',
  'outbound-picked-scans', 'outbound-reviewed-measured', 'outbound-ready-to-ship', 'outbound-shipped', '完成',
])

await verifyPod('货盘流程', catalogSession.token, manifest.catalog.customerCode, manifest.catalog.outboundNo, manifest.catalog.podFile)
await verifyPod('电商流程', ecommerceSession.token, manifest.ecommerce.customerCode, manifest.ecommerce.outboundNo, manifest.ecommerce.podFile)

const report = {
  generatedAt: new Date().toISOString(),
  manifest: manifestPath,
  ok: checks.every(check => check.ok),
  passed: checks.filter(check => check.ok).length,
  failed: checks.filter(check => !check.ok).length,
  checks,
}
const outputPath = localPath(manifest.evidenceOutput || 'e2e-real-evidence-report.json')
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n验收报告：${outputPath}`)
console.log(`通过 ${report.passed}，失败 ${report.failed}`)
if (!report.ok) process.exitCode = 1
