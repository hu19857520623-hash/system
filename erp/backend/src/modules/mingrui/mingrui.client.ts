import { ConfigService } from '@nestjs/config'

const DEFAULT_API_BASE = 'https://ws.ai-ops.vip'
const TRACKING_PATH = '/edi/web-services/v5/tracking'
const SHIPMENT_PATH = '/edi/web-services/fms/v2/getOneShipment'
const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

export type MingruiBookingInput = {
  shipmentNo: string
  mode: string
  destWarehouse?: string | null
  originCity?: string | null
  destPort?: string | null
  packages?: number | null
  weightKg?: number | null
  volumeCbm?: number | null
  poNos?: string | null
  cargoItems?: unknown
  remark?: string | null
}

export type MingruiTrackingNode = {
  status?: string
  statusName?: string
  eventTime?: string
  location?: string
  description?: string
}

export type MingruiQueryInput = {
  shipmentNo: string
  mingruiOrderNo?: string | null
  trackingRef?: string | null
  blNo?: string | null
}

export type MingruiAdapterResult = {
  ok: boolean
  configured: boolean
  message: string
  mingruiOrderNo?: string
  trackingRef?: string
  trackingStatus?: string
  trackingDetail?: string
  localStatus?: string
  trackingNodes?: MingruiTrackingNode[]
  blNo?: string
  containerNo?: string
  vesselName?: string
  originCity?: string
  destPort?: string
  packages?: number
  weightKg?: number
  volumeCbm?: number
  etd?: string
  eta?: string
  raw?: unknown
}

type HttpJsonResult = {
  ok: boolean
  httpStatus: number
  message: string
  data: Record<string, unknown> | null
  raw: unknown
}

/**
 * 明瑞物流 AI-OPS 适配器。
 * 查询：GET /edi/web-services/v5/tracking、GET /edi/web-services/fms/v2/getOneShipment
 * 下单接口文档未提供，createBooking 仍只保存本地记录。
 */
export class MingruiClient {
  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  isConfigured(): boolean {
    return Boolean(this.appKey() && this.appToken())
  }

  apiBase(): string {
    return String(this.config.get('MINGRUI_API_BASE') || DEFAULT_API_BASE).trim().replace(/\/+$/, '')
  }

  private appKey(): string {
    return firstEnv(this.config, ['MINGRUI_APP_KEY', 'MINGRUI_API_KEY', 'AI_OPS_APP_KEY'])
  }

  private appToken(): string {
    return firstEnv(this.config, ['MINGRUI_APP_TOKEN', 'MINGRUI_API_TOKEN', 'AI_OPS_APP_TOKEN'])
  }

  notConfiguredResult(action: string): MingruiAdapterResult {
    return {
      ok: false,
      configured: false,
      message: `明瑞物流 API 尚未接入，${action}已保存在本地。配置 MINGRUI_APP_KEY / MINGRUI_APP_TOKEN 后即可查询跟踪状态与订单信息。`,
    }
  }

  async createBooking(input: MingruiBookingInput): Promise<MingruiAdapterResult> {
    if (!this.isConfigured()) {
      return this.notConfiguredResult(`运单 ${input.shipmentNo} 下单`)
    }
    return {
      ok: false,
      configured: true,
      message: '明瑞物流查询接口已接通，下单/订舱接口文档尚未提供。请保存草稿，填写明瑞工作号后同步物流信息。',
      raw: { shipmentNo: input.shipmentNo },
    }
  }

  async queryTracking(ref: MingruiQueryInput): Promise<MingruiAdapterResult> {
    if (!this.isConfigured()) {
      return this.notConfiguredResult(`运单 ${ref.shipmentNo} 物流查询`)
    }

    const jobNum = text(ref.mingruiOrderNo)
    let trackingRef = text(ref.trackingRef) || text(ref.blNo)
    if (!jobNum && !trackingRef) {
      return {
        ok: false,
        configured: true,
        message: '请填写明瑞工作号（jobNum，如 SEAE260713941）或跟踪参考号（trackingRef）后再同步。',
      }
    }

    const errors: string[] = []
    let shipment: Record<string, unknown> | null = null
    let tracking: Record<string, unknown> | null = null

    if (jobNum) {
      const shipRes = await this.getJson(SHIPMENT_PATH, { jobNum })
      if (shipRes.ok && shipRes.data) {
        shipment = shipRes.data
        trackingRef = trackingRef
          || text(pick(shipment, 'trackingRef', 'tracking_ref', 'hblNum', 'hbl', 'trackNo', 'trackRef'))
      } else {
        errors.push(shipRes.message)
      }
    }

    if (trackingRef) {
      const trackRes = await this.getJson(TRACKING_PATH, { trackingRef })
      if (trackRes.ok && trackRes.data) {
        tracking = trackRes.data
      } else {
        errors.push(trackRes.message)
      }
    }

    if (!shipment && !tracking) {
      return {
        ok: false,
        configured: true,
        message: errors.join('；') || '明瑞物流查询无结果',
        raw: { jobNum, trackingRef },
      }
    }

    return this.mapQueryResult(shipment, tracking, jobNum, trackingRef, errors)
  }

  private mapQueryResult(
    shipment: Record<string, unknown> | null,
    tracking: Record<string, unknown> | null,
    jobNum: string | undefined,
    trackingRef: string | undefined,
    errors: string[],
  ): MingruiAdapterResult {
    const src = { ...(shipment || {}), ...(tracking || {}) }
    const nodes = asNodes(
      pick(tracking, 'dataList', 'nodes', 'nodeList', 'tracks', 'events')
      ?? pick(src, 'dataList', 'nodes'),
    )
    const statusCode = text(
      pick(tracking, 'status', 'statusCode')
      ?? pick(src, 'status', 'statusCode', 'shipmentStatus'),
    )
    const statusName = text(
      pick(tracking, 'statusName', 'statusDesc', 'currentStatusName')
      ?? pick(src, 'statusName', 'statusDesc'),
    ) || humanizeStatusCode(statusCode)
    const origin = placeName(pick(src, 'origin', 'originCity', 'pol', 'polName', 'porName', 'placeOfReceipt'))
    const destination = placeName(
      pick(src, 'destination', 'destPort', 'pod', 'podName', 'destName', 'placeOfDelivery'),
    )
    const packages = pkgCount(pick(src, 'packages', 'pkgs', 'packageQty', 'pkgQty', 'ctns'))
    const weightKg = toNumber(pick(src, 'weight', 'weightKg', 'grossWeight', 'gw'))
    const volumeCbm = toNumber(pick(src, 'volume', 'volumeCbm', 'cbm', 'measurement', 'vol'))
    const resolvedJob = text(pick(src, 'jobNum', 'jobNo', 'orderNo')) || jobNum
    const resolvedRef = text(pick(src, 'trackingRef', 'tracking_ref', 'hblNum', 'hbl')) || trackingRef
    const trackingStatus = statusName || statusCode
    const detail = formatNodes(nodes) || trackingStatus || errors.join('；')

    return {
      ok: true,
      configured: true,
      message: errors.length ? `已查询到部分物流信息：${errors.join('；')}` : '已同步明瑞物流信息',
      mingruiOrderNo: resolvedJob,
      trackingRef: resolvedRef,
      trackingStatus,
      trackingDetail: detail,
      localStatus: mapLocalStatus(statusCode, statusName),
      trackingNodes: nodes,
      blNo: text(pick(src, 'blNo', 'billNo', 'mblNo', 'hblNo', 'hblNum'))
        || firstRef(src, 'bl', 'bill', 'lading'),
      containerNo: text(pick(src, 'containerNo', 'cntrNo', 'ctnrNo'))
        || firstRef(src, 'container', 'cntr', 'box'),
      vesselName: text(pick(src, 'vesselName', 'vessel', 'shipName', 'vsl'))
        || placeName(pick(src, 'vessel')),
      originCity: origin,
      destPort: destination,
      packages,
      weightKg,
      volumeCbm,
      etd: text(pick(src, 'etd', 'estimatedDeparture')),
      eta: text(pick(src, 'eta', 'estimatedArrival')),
      raw: { shipment, tracking },
    }
  }

  private async getJson(path: string, query: Record<string, string>): Promise<HttpJsonResult> {
    const url = new URL(path, `${this.apiBase()}/`)
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }

    let last: HttpJsonResult = {
      ok: false,
      httpStatus: 0,
      message: '明瑞物流接口无响应',
      data: null,
      raw: null,
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            appKey: this.appKey(),
            appToken: this.appToken(),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        const body = await res.text().catch(() => '')
        const parsed = parseJson(body)
        const bizMessage = bizMsg(parsed)
        if (!res.ok) {
          const mapped = httpErrorMessage(res.status)
          last = {
            ok: false,
            httpStatus: res.status,
            message: res.status === 401 || res.status === 403 ? mapped : (bizMessage || mapped),
            data: null,
            raw: parsed ?? truncate(body),
          }
          if (!shouldRetry(res.status) || attempt === MAX_ATTEMPTS) return last
        } else if (!isBizOk(parsed)) {
          return {
            ok: false,
            httpStatus: res.status,
            message: bizMessage || '明瑞物流查询失败',
            data: asRecord(unwrapData(parsed)),
            raw: parsed,
          }
        } else {
          return {
            ok: true,
            httpStatus: res.status,
            message: bizMessage || 'ok',
            data: asRecord(unwrapData(parsed)),
            raw: parsed,
          }
        }
      } catch (err) {
        last = {
          ok: false,
          httpStatus: 0,
          message: err instanceof Error && err.name === 'TimeoutError'
            ? '明瑞物流接口超时'
            : `明瑞物流接口请求失败：${err instanceof Error ? err.message : String(err)}`,
          data: null,
          raw: null,
        }
        if (attempt === MAX_ATTEMPTS) return last
      }
      await sleep(300 * 2 ** (attempt - 1))
    }
    return last
  }
}

function firstEnv(config: ConfigService, keys: string[]): string {
  for (const key of keys) {
    const value = String(config.get(key) || '').trim()
    if (value) return value
  }
  return ''
}

function text(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function pick(source: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    if (source[key] != null && source[key] !== '') return source[key]
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function parseJson(body: string): unknown {
  if (!body.trim()) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function unwrapData(json: unknown): unknown {
  const record = asRecord(json)
  if (!record) return json
  if (record.data != null && typeof record.data === 'object') return record.data
  if (record.result != null && typeof record.result === 'object') return record.result
  if (record.content != null && typeof record.content === 'object') return record.content
  return record
}

function isBizOk(json: unknown): boolean {
  const record = asRecord(json)
  if (!record) return false
  if ('success' in record) {
    return record.success === true || record.success === 'true' || record.success === 1
  }
  if ('code' in record) {
    const code = String(record.code).trim().toLowerCase()
    if (code === '0' || code === '200' || code === 'ok' || code === 'success') return true
  }
  return record.data != null || record.result != null || record.jobNum != null || record.dataList != null
}

function bizMsg(json: unknown): string | undefined {
  const record = asRecord(json)
  return text(pick(record || {}, 'message', 'msg', 'error', 'errorMessage'))
}

function httpErrorMessage(status: number): string {
  if (status === 400) return '明瑞查询参数无效'
  if (status === 401 || status === 403) return '明瑞物流认证失败，请检查 APP_KEY / APP_TOKEN'
  if (status === 404) return '明瑞物流接口或运单不存在'
  if (status === 429) return '明瑞物流查询过于频繁，请稍后重试'
  if (status >= 500) return `明瑞物流服务异常（HTTP ${status}）`
  return `明瑞物流查询失败（HTTP ${status}）`
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500
}

function placeName(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'string' || typeof value === 'number') return text(value)
  const record = asRecord(value)
  if (!record) return undefined
  return text(pick(record, 'name', 'city', 'port', 'portName', 'fullName', 'location', 'code'))
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const record = asRecord(value)
  const raw = record && (record.value ?? record.amount ?? record.qty) != null
    ? record.value ?? record.amount ?? record.qty
    : value
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function pkgCount(value: unknown): number | undefined {
  if (value == null) return undefined
  if (Array.isArray(value)) {
    const total = value.reduce((sum, row) => sum + (toNumber(asRecord(row)?.quantity ?? asRecord(row)?.qty ?? asRecord(row)?.count) || 0), 0)
    return total || undefined
  }
  return toNumber(value)
}

function asNodes(raw: unknown): MingruiTrackingNode[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)?.list)
      ? (asRecord(raw)!.list as unknown[])
      : []
  return list.map((row) => {
    const node = asRecord(row) || {}
    const context = text(pick(node, 'context', 'description', 'desc', 'remark', 'detail', 'message'))
    return {
      status: text(pick(node, 'node', 'status', 'statusCode', 'nodeStatus')),
      statusName: text(pick(node, 'statusName', 'statusDesc', 'nodeName', 'name')) || context,
      eventTime: text(pick(node, 'time', 'nodeTime', 'eventTime', 'occurTime', 'dateTime', 'opTime')),
      location: placeName(pick(node, 'location', 'place', 'city')),
      description: context,
    }
  }).filter((node) => node.status || node.statusName || node.description || node.eventTime)
}

function formatNodes(nodes: MingruiTrackingNode[]): string | undefined {
  if (!nodes.length) return undefined
  return nodes
    .map((node) => [node.eventTime, node.location, node.statusName || node.status, node.description]
      .filter(Boolean)
      .join(' · '))
    .join('\n')
}

function firstRef(source: Record<string, unknown>, ...hints: string[]): string | undefined {
  const refs = source.references
  const list = Array.isArray(refs) ? refs : []
  for (const row of list) {
    const record = asRecord(row) || {}
    const type = `${record.type || record.refType || record.kind || record.code || ''}`.toLowerCase()
    const value = text(pick(record, 'value', 'refNo', 'number', 'no', 'ref'))
    if (value && hints.some((hint) => type.includes(hint))) return value
  }
  return undefined
}

function mapLocalStatus(code?: string, name?: string): string | undefined {
  const hay = `${code || ''} ${name || ''}`.toLowerCase()
  if (!hay.trim()) return undefined
  if (/cancel|void|作废|取消/.test(hay)) return 'cancelled'
  if (/arriv|ata|deliver|discharge|到港|抵达|送达/.test(hay)) return 'arrived'
  if (/intransit|in_transit|transit|depart|sail|on_?board|picked|collect|ship|在途|运输|开船|已提/.test(hay)) return 'in_transit'
  if (/book|confirm|订舱|已订/.test(hay)) return 'booked'
  return undefined
}

function humanizeStatusCode(code?: string): string | undefined {
  if (!code) return undefined
  const normalized = code.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim()
  return normalized || undefined
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
