type ReturnPlatform = 'takealot' | 'other'
type ReturnDetails = {
  filledBy?: string; department?: string; selfRecall?: 'yes' | 'no'
  inboundPoNumber?: string; purchasePrice?: number; userType?: string
}
type ReturnForm = { remark: string | null; returnPlatform?: ReturnPlatform; takealotReturnDetails?: ReturnDetails }
const PREFIX = '__OMS_RETURN_FORM_V1__:'

export class ReturnFormValidationError extends Error {}

function details(value: unknown): ReturnDetails | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new ReturnFormValidationError('退件补充资料格式无效，请核对后重新保存')
  const source = value as Record<string, unknown>, result: ReturnDetails = {}
  for (const key of ['filledBy', 'department', 'inboundPoNumber', 'userType'] as const) {
    if (source[key] == null) continue
    if (typeof source[key] !== 'string') throw new ReturnFormValidationError('退件补充资料中的文字内容格式无效，请核对后重新保存')
    result[key] = source[key].trim()
  }
  if (source.selfRecall != null) {
    if (source.selfRecall !== 'yes' && source.selfRecall !== 'no') throw new ReturnFormValidationError('请选择是否自主召回')
    result.selfRecall = source.selfRecall
  }
  if (source.purchasePrice != null && source.purchasePrice !== '') {
    const price = Number(source.purchasePrice)
    if (!Number.isFinite(price) || price < 0) throw new ReturnFormValidationError('当时采购价须为不小于零的有效金额')
    result.purchasePrice = price
  }
  return result
}

/** The existing remark column holds a versioned form snapshot; clients see only the user's remark. */
export function readReturnFormMetadata(stored: string | null | undefined): ReturnForm {
  const legacy = { remark: stored ?? null }
  if (!stored?.startsWith(PREFIX)) return legacy
  try {
    const parsed = JSON.parse(stored.slice(PREFIX.length))
    if (parsed?.version !== 1 || !['takealot', 'other'].includes(parsed.returnPlatform)
      || (parsed.remark !== null && typeof parsed.remark !== 'string')) return legacy
    return { remark: parsed.remark, returnPlatform: parsed.returnPlatform,
      takealotReturnDetails: parsed.returnPlatform === 'takealot' ? details(parsed.takealotReturnDetails) : undefined }
  } catch { return legacy }
}

export function writeReturnFormMetadata(input: Record<string, unknown>, previous?: string | null): string | null {
  const old = readReturnFormMetadata(previous)
  const platform = input.returnPlatform ?? old.returnPlatform
  if (platform != null && platform !== 'takealot' && platform !== 'other') throw new ReturnFormValidationError('请选择有效的退货平台')
  const remark = input.remark === undefined ? old.remark : input.remark == null ? null : String(input.remark)
  if (!platform) return remark
  const snapshot = input.takealotReturnDetails === undefined ? old.takealotReturnDetails : details(input.takealotReturnDetails)
  return PREFIX + JSON.stringify({ version: 1, remark, returnPlatform: platform,
    takealotReturnDetails: platform === 'takealot' ? snapshot : undefined })
}
