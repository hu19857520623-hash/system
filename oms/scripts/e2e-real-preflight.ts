/** Read-only prerequisites for the three real-data ERP/OMS/PDA E2E flows.
 * No orders, stock, users, or files are changed by this command.
 */
import { readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { mapCsvRows, parseCsv, readImportFileText } from '../src/data/csvImportExport'
import { PRODUCT_COLUMNS, parseProducts } from '../src/data/importTemplates'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotIdentityConflicts,
} from '../src/data/takealotDocParser'
import { extractPdfTextModelFromData } from '../src/data/takealotPdfText'

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
const setting = (name: string) => String(process.env[name] || '').trim()

function endpoint(base: string, path: string) {
  const normalizedBase = base.replace(/\/$/, '')
  if (normalizedBase.endsWith('/api') && path.startsWith('/api/')) {
    return `${normalizedBase}${path.slice(4)}`
  }
  return `${normalizedBase}${path}`
}

async function health(name: string, envName: string, path: string) {
  const base = setting(envName)
  if (!base) return add(name, false, `缺少 ${envName}`)
  try {
    const response = await fetch(endpoint(base, path), {
      signal: AbortSignal.timeout(8000),
    })
    add(name, response.ok, `HTTP ${response.status}`)
  } catch (error) {
    add(name, false, `连接失败：${(error as Error).message}`)
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

async function erpLogin() {
  const base = setting('ERP_E2E_BASE')
  const username = setting('ERP_E2E_USERNAME')
  const password = setting('ERP_E2E_PASSWORD')
  if (!base || !username || !password) {
    return add(
      'ERP 仓库/采购测试账号',
      false,
      '缺少 ERP_E2E_BASE、ERP_E2E_USERNAME 或 ERP_E2E_PASSWORD',
    )
  }
  try {
    const response = await fetch(endpoint(base, '/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    })
    const payload = await responseJson(response)
    const data = payload.data as Record<string, unknown> | undefined
    const user = data?.user as Record<string, unknown> | undefined
    const permissions = Array.isArray(user?.permissions) ? user.permissions.map(String) : []
    const required = [
      'product_dev.create',
      'purchase.create',
      'purchase.po_audit',
      'create_inbound.create',
      'inbound.arrival_scan',
      'inbound.receive',
      'inbound.qc',
      'inbound.putaway',
      'outbound.pick',
      'outbound.pack',
      'outbound.ship',
    ]
    const missing = required.filter(permission => !permissions.includes(permission))
    const authenticated = response.ok && payload.code === 0 && Boolean(data?.token)
    const ok = authenticated && missing.length === 0
    add(
      'ERP 仓库/采购测试账号',
      ok,
      !authenticated
        ? `登录失败：HTTP ${response.status}`
        : missing.length
          ? `登录成功，但缺少端到端流程权限：${missing.join('、')}`
          : `登录成功；角色 ${String(user?.roleCode || '未知')}`,
    )
  } catch (error) {
    add('ERP 仓库/采购测试账号', false, `登录验证失败：${(error as Error).message}`)
  }
}

async function omsLogin(
  title: string,
  usernameEnv: string,
  passwordEnv: string,
  expectedRole: 'catalog' | 'ecommerce',
  requiredPermissions: string[],
) {
  const base = setting('OMS_E2E_BASE')
  const username = setting(usernameEnv)
  const password = setting(passwordEnv)
  if (!base || !username || !password) {
    return add(title, false, `缺少 OMS_E2E_BASE、${usernameEnv} 或 ${passwordEnv}`)
  }
  try {
    const response = await fetch(endpoint(base, '/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    })
    const payload = await responseJson(response)
    const user = payload.user as Record<string, unknown> | undefined
    const permissions = Array.isArray(user?.permissions) ? user.permissions.map(String) : []
    const role = String(user?.role || '')
    const type = String(user?.type || '')
    const missing = requiredPermissions.filter(permission => !permissions.includes(permission))
    const authenticated = response.ok && Boolean(payload.token)
    const roleMatches = role === expectedRole && type === expectedRole
    const passwordReady = user?.mustChangePassword !== true
    const ok = authenticated && roleMatches && passwordReady && missing.length === 0
    add(
      title,
      ok,
      !authenticated
        ? `登录失败：HTTP ${response.status}`
        : !roleMatches
          ? `账号类型不符：role=${role || '未知'}，type=${type || '未知'}，应为 ${expectedRole}`
          : !passwordReady
            ? '登录成功，但必须先修改临时密码'
            : missing.length
              ? `登录成功，但缺少端到端流程权限：${missing.join('、')}`
              : `登录成功；客户代码 ${String(user?.customerCode || '未知')}`,
    )
  } catch (error) {
    add(title, false, `登录验证失败：${(error as Error).message}`)
  }
}

async function file(name: string, envName: string, signature?: string) {
  const path = setting(envName)
  if (!path) return add(name, false, `缺少 ${envName}`)
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return add(name, false, '文件为空或不是普通文件')
    if (signature) {
      const bytes = await readFile(path)
      if (bytes.subarray(0, signature.length).toString('ascii') !== signature) {
        return add(name, false, `${basename(path)} 文件格式不符`)
      }
    }
    add(name, true, `${basename(path)} (${info.size} bytes)`)
  } catch (error) {
    add(name, false, `文件不可读：${(error as Error).message}`)
  }
}

async function imageFile(name: string, envName: string) {
  const path = setting(envName)
  if (!path) return add(name, false, `缺少 ${envName}`)
  try {
    const bytes = await readFile(path)
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const isGif = ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
    const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    add(name, bytes.length > 0 && bytes.length <= 5 * 1024 * 1024 && (isJpeg || isPng || isGif || isWebp),
      `${basename(path)}：${bytes.length} bytes；${bytes.length > 5 * 1024 * 1024 ? '超过 5MB' : '检查图片格式'}`)
  } catch (error) {
    add(name, false, `文件不可读：${(error as Error).message}`)
  }
}

async function workbook() {
  const path = setting('E2E_XLSX_FILE')
  if (!path) return add('真实 XLSX 商品数据', false, '缺少 E2E_XLSX_FILE')
  try {
    const bytes = await readFile(path)
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return add('真实 XLSX 商品数据', false, '不是 .xlsx 工作簿')
    }
    const result = await readImportFileText(new File([bytes], basename(path)), PRODUCT_COLUMNS)
    const mapped = mapCsvRows(parseCsv(result.text), PRODUCT_COLUMNS, result.lineOffset)
    const parsed = parseProducts(mapped.records)
    const errors = [...mapped.errors, ...parsed.errors]
    add('真实 XLSX 商品数据', parsed.data.length > 0 && errors.length === 0,
      `${basename(path)}：合格 ${parsed.data.length} 条，错误 ${errors.length} 条${errors.length ? `；首条：${errors[0]}` : ''}`)
  } catch (error) {
    add('真实 XLSX 商品数据', false, `解析失败：${(error as Error).message}`)
  }
}

function device() {
  const adb = setting('PDA_E2E_ADB') || 'adb'
  try {
    const output = execFileSync(adb, ['devices', '-l'], { encoding: 'utf8', timeout: 8000 })
    const connected = output.split(/\r?\n/).filter(line => /\sdevice(?:\s|$)/.test(line))
    const requested = setting('PDA_E2E_SERIAL')
    const matched = requested
      ? connected.some(line => line.startsWith(`${requested} `) || line.startsWith(`${requested}\t`))
      : connected.length === 1
    add('真实 PDA/Android 设备', matched,
      matched ? `设备已连接：${requested || connected[0].split(/\s/)[0]}`
        : requested ? `未找到指定设备 ${requested}` : `需连接且只连接一台设备；当前 ${connected.length} 台`)
  } catch (error) {
    add('真实 PDA/Android 设备', false, `adb 不可用：${(error as Error).message}`)
  }
}

const pdfInputs = (flow: 'CATALOG' | 'ECOMMERCE', title: string) => [
  file(`${title}外箱标 PDF`, `E2E_${flow}_OUTER_LABEL_PDF`, '%PDF-'),
  file(`${title}预约单 PDF`, `E2E_${flow}_BOOKING_PDF`, '%PDF-'),
  file(`${title}发货清单 PDF`, `E2E_${flow}_SHIPPING_NOTE_PDF`, '%PDF-'),
  file(`${title}商品标签 PDF`, `E2E_${flow}_PRODUCT_LABEL_PDF`, '%PDF-'),
]

type ShipmentIdentity = {
  bookingRef: string
  poNumber?: string
  sellerId?: string
  warehouseCode?: string
}

async function shipmentIdentity(
  flow: 'CATALOG' | 'ECOMMERCE',
  title: string,
): Promise<ShipmentIdentity | undefined> {
  const inputs = [
    ['OUTER_LABEL_PDF', '外箱标'],
    ['BOOKING_PDF', '预约单'],
    ['SHIPPING_NOTE_PDF', '发货清单'],
    ['PRODUCT_LABEL_PDF', 'SKU 标签'],
  ] as const
  const paths = inputs.map(([suffix]) => setting(`E2E_${flow}_${suffix}`))
  if (paths.some(path => !path)) return undefined
  try {
    const parts = []
    for (const [index, path] of paths.entries()) {
      const bytes = await readFile(path)
      const model = await extractPdfTextModelFromData(new Uint8Array(bytes))
      const kind = detectTakealotDocKind(basename(path), model.text)
      const expectedKind = inputs[index][1]
      if (kind !== expectedKind) {
        add(`${title}四份发货文件业务身份`, false, `${basename(path)} 被识别为“${kind}”，应为“${expectedKind}”`)
        return undefined
      }
      parts.push(
        parseTakealotFilename(basename(path)),
        parseTakealotDocumentText(model.text, kind),
      )
    }
    const conflicts = takealotIdentityConflicts(parts)
    const parsed = mergeTakealotParsed(...parts)
    const ok = Boolean(parsed.bookingRef && parsed.poNumber && parsed.sellerId && parsed.warehouseCode)
      && conflicts.length === 0
    add(
      `${title}四份发货文件业务身份`,
      ok,
      ok
        ? `预约号 ${parsed.bookingRef}；PO ${parsed.poNumber}；卖家 ${parsed.sellerId}；仓库 ${parsed.warehouseCode}`
        : conflicts.length
          ? `业务字段冲突：${conflicts.join('；')}`
          : '四份发货文件合并后缺少预约号、PO、卖家或仓库字段',
    )
    if (!ok || !parsed.bookingRef) return undefined
    return {
      bookingRef: parsed.bookingRef,
      poNumber: parsed.poNumber,
      sellerId: parsed.sellerId,
      warehouseCode: parsed.warehouseCode,
    }
  } catch (error) {
    add(`${title}四份发货文件业务身份`, false, `解析失败：${(error as Error).message}`)
    return undefined
  }
}

await Promise.all([
  health('ERP API', 'ERP_E2E_BASE', '/auth/health'),
  health('OMS API', 'OMS_E2E_BASE', '/api/health'),
  erpLogin(),
  omsLogin(
    'OMS 货盘客户测试账号',
    'OMS_E2E_CATALOG_USERNAME',
    'OMS_E2E_CATALOG_PASSWORD',
    'catalog',
    ['catalog:read', 'catalog:write', 'outbound:read', 'outbound:write'],
  ),
  omsLogin(
    'OMS 电商客户测试账号',
    'OMS_E2E_ECOMMERCE_USERNAME',
    'OMS_E2E_ECOMMERCE_PASSWORD',
    'ecommerce',
    ['product:read', 'product:write', 'inbound:read', 'inbound:write', 'outbound:read', 'outbound:write'],
  ),
  imageFile('ERP 选品商品图片', 'E2E_ERP_IMAGE_FILE'),
  imageFile('电商客户商品图片', 'E2E_ECOMMERCE_IMAGE_FILE'),
  ...pdfInputs('CATALOG', '货盘客户'),
  ...pdfInputs('ECOMMERCE', '电商客户'),
  workbook(),
])
const [catalogBooking, ecommerceBooking] = await Promise.all([
  shipmentIdentity('CATALOG', '货盘客户'),
  shipmentIdentity('ECOMMERCE', '电商客户'),
])
const distinctBookings = Boolean(
  catalogBooking
  && ecommerceBooking
  && catalogBooking.bookingRef !== ecommerceBooking.bookingRef,
)
add(
  '两类客户使用不同的真实预约单',
  distinctBookings,
  catalogBooking && ecommerceBooking
    ? `货盘 ${catalogBooking.bookingRef}；电商 ${ecommerceBooking.bookingRef}`
    : '需先成功解析货盘与电商两份预约单的业务身份',
)
device()

console.log(JSON.stringify({ ready: checks.every(check => check.ok), checks }, null, 2))
if (checks.some(check => !check.ok)) process.exitCode = 1
