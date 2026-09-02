export type WcsWeighItem = {
  ticketsNum: string
  weight: string
  length: string
  width: string
  height: string
  volume: string
  machine: string
  memberno: string
  warehouse: string
  goodsname: string
  goodsnum: string
  expressname: string
  myremarks: string
}

export type WcsWeighReply = {
  result: 'true' | 'false'
  message: string
  printdata?: string
}

export const WCS_MEMBER_ID_MESSAGE = 'Member ID'
export const WCS_IMAGE_OK = { isOk: 1 as const }

/** 文档 1.4 成功示例（message 为空字符串） */
export const WCS_SPEC_WEIGH_SUCCESS = { result: 'true' as const, message: '' }

/** 文档 1.5 补录会员号 */
export const WCS_SPEC_WEIGH_MEMBER_ID = {
  result: 'true' as const,
  message: WCS_MEMBER_ID_MESSAGE,
}

/** 与 Python WCSWMSClient.to_payload() 一致：单个 JSON 对象，不是数组 */
export const WCS_SPEC_SAMPLE_WEIGH_BODY = {
  ticketsNum: '12345',
  weight: '1.000',
  length: '1.0',
  width: '1.0',
  height: '1.0',
  volume: '0.0',
  machine: 'OOPS-DWS-01',
  memberno: '会员代号',
  warehouse: '仓位号',
  goodsname: '品名字段',
  goodsnum: '1',
  expressname: '供应商字段',
  myremarks: '备注字段',
}

export function asWcsString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export function normalizeWcsWeighBody(body: unknown): WcsWeighItem[] {
  if (body == null) return []
  const list = Array.isArray(body) ? body : [body]
  return list
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map((o) => ({
      ticketsNum: asWcsString(o.ticketsNum ?? o.tickets_num),
      weight: asWcsString(o.weight),
      length: asWcsString(o.length),
      width: asWcsString(o.width),
      height: asWcsString(o.height),
      volume: asWcsString(o.volume),
      machine: asWcsString(o.machine),
      memberno: asWcsString(o.memberno ?? o.memberNo ?? o.member_no),
      warehouse: asWcsString(o.warehouse),
      goodsname: asWcsString(o.goodsname ?? o.goodsName ?? o.goods_name),
      goodsnum: asWcsString(o.goodsnum ?? o.goodsNum ?? o.goods_num),
      expressname: asWcsString(o.expressname ?? o.expressName ?? o.express_name),
      myremarks: asWcsString(o.myremarks ?? o.remarks),
    }))
}

export function validateWcsWeighItem(item: WcsWeighItem): string | null {
  if (!item.ticketsNum) return 'ticketsNum 不能为空'
  if (!item.weight) return 'weight 不能为空'
  if (!item.machine) return 'machine 不能为空'
  return null
}

export function buildWcsWeighReply(opts: {
  ok: boolean
  message: string
  printData?: string | null
}): WcsWeighReply {
  const reply: WcsWeighReply = {
    result: opts.ok ? 'true' : 'false',
    message: opts.message,
  }
  if (opts.ok && opts.printData) reply.printdata = opts.printData
  return reply
}

/** 按安衡文档生成 WMS（本模块）当前会回给设备的 JSON */
export function previewWmsOutputs(config: {
  chuteMessage?: string | null
  requireMemberId?: boolean
  printData?: string | null
}) {
  const successMessage = config.requireMemberId ? WCS_MEMBER_ID_MESSAGE : asWcsString(config.chuteMessage)
  return {
    weighSuccess: buildWcsWeighReply({
      ok: true,
      message: successMessage,
      printData: config.printData,
    }),
    weighMemberId: { ...WCS_SPEC_WEIGH_MEMBER_ID },
    weighFail: buildWcsWeighReply({ ok: false, message: 'ticketsNum 不能为空' }),
    imageOk: { ...WCS_IMAGE_OK },
  }
}

export function extractPresentedDeviceKey(input: {
  header?: string | string[]
  query?: unknown
  body?: unknown
}): string {
  const header = Array.isArray(input.header) ? input.header[0] : input.header
  if (asWcsString(header)) return asWcsString(header)
  if (asWcsString(input.query)) return asWcsString(input.query)
  if (input.body && typeof input.body === 'object' && !Array.isArray(input.body)) {
    const body = input.body as Record<string, unknown>
    if (asWcsString(body.deviceKey ?? body.key)) return asWcsString(body.deviceKey ?? body.key)
  }
  return ''
}

export function deviceKeyAccepted(configured: string | null | undefined, presented: string): boolean {
  const expected = asWcsString(configured)
  if (!expected) return true
  return presented === expected
}

export function stripBase64Prefix(file: unknown): string {
  const raw = String(file ?? '').replace(/\s/g, '')
  const marker = 'base64,'
  const idx = raw.toLowerCase().indexOf(marker)
  return idx >= 0 ? raw.slice(idx + marker.length) : raw
}

export function decodeJpegBase64(file: unknown): { buffer: Buffer; error: string | null } {
  const payload = stripBase64Prefix(file)
  if (!payload) return { buffer: Buffer.alloc(0), error: 'file 不能为空' }
  let buffer: Buffer
  try {
    buffer = Buffer.from(payload, 'base64')
  } catch {
    return { buffer: Buffer.alloc(0), error: 'file 不是合法 Base64' }
  }
  if (!buffer.length) return { buffer, error: 'file 解码后为空' }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { buffer, error: 'file 不是 JPEG' }
  return { buffer, error: null }
}

export function clientIpFromRequest(req: {
  ip?: string
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}): string {
  const fwd = req.headers?.['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd
  if (asWcsString(first)) return asWcsString(first).split(',')[0].trim().slice(0, 64)
  return asWcsString(req.ip || req.socket?.remoteAddress).slice(0, 64)
}
