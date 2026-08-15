export type OutboundLabelAction = 'order' | 'sku' | 'unit'

export interface OutboundLabelLine {
  key: string
  internalSku: string
  expectedQty: number
  croppedLabelCount: number
  mappingReady: boolean
  labelReady: boolean
  countMatches: boolean
  printable: boolean
  unitIndices: number[]
}

export interface OutboundLabelSummary {
  isTakealot: boolean
  hasLabelMetadata: boolean
  lines: OutboundLabelLine[]
  totalExpectedQty: number
  totalCroppedLabels: number
  allPrintable: boolean
}

type UnknownRecord = Record<string, unknown>

const LABEL_METADATA_KEYS = [
  'croppedLabelCount',
  'labelCount',
  'unitLabelCount',
  'unitIndices',
  'unitLabels',
  'croppedLabels',
  'mappingReady',
  'labelReady',
  'labelsReady',
  'labelMetadata',
] as const

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function firstDefined(...values: unknown[]) {
  return values.find(value => value !== undefined && value !== null)
}

function toNonNegativeInteger(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0
}

function readReadyFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (['true', 'ready', 'mapped', 'matched', 'complete', 'completed', 'available'].includes(normalized)) {
    return true
  }
  if (['false', 'pending', 'unmapped', 'missing', 'incomplete', 'failed', 'unavailable'].includes(normalized)) {
    return false
  }
  return undefined
}

function firstArray(...values: unknown[]): unknown[] {
  let emptyArray: unknown[] | undefined
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length) return value
      emptyArray ??= value
    }
  }
  return emptyArray ?? []
}

function getMetadataContainer(line: UnknownRecord) {
  return asRecord(firstDefined(
    line.labelMetadata,
    line.skuLabelMetadata,
    line.platformLabel,
    line.skuLabel,
  ))
}

function lineHasMetadata(line: UnknownRecord) {
  const metadata = getMetadataContainer(line)
  return LABEL_METADATA_KEYS.some(key => key in line || key in metadata)
}

function readUnitIndices(line: UnknownRecord, metadata: UnknownRecord) {
  const units = firstArray(
    line.unitIndices,
    metadata.unitIndices,
    line.availableUnitIndices,
    metadata.availableUnitIndices,
    line.unitLabels,
    metadata.unitLabels,
    line.croppedLabels,
    metadata.croppedLabels,
    line.labels,
    metadata.labels,
    line.units,
    metadata.units,
  )

  const indices = units
    .map((unit, index) => {
      if (typeof unit === 'number' || typeof unit === 'string') return Number(unit)
      const unitRecord = asRecord(unit)
      return Number(firstDefined(
        unitRecord.unitIndex,
        unitRecord.index,
        unitRecord.labelIndex,
        index + 1,
      ))
    })
    .filter(index => Number.isFinite(index) && index >= 0)
    .map(index => Math.trunc(index))

  return [...new Set(indices)].sort((a, b) => a - b)
}

function readLabelCount(line: UnknownRecord, metadata: UnknownRecord, unitIndices: number[]) {
  const explicitCount = firstDefined(
    line.croppedLabelCount,
    metadata.croppedLabelCount,
    line.labelCount,
    metadata.labelCount,
    line.unitLabelCount,
    metadata.unitLabelCount,
    line.croppedCount,
    metadata.croppedCount,
  )
  return explicitCount === undefined
    ? unitIndices.length
    : toNonNegativeInteger(explicitCount)
}

function normalizeLine(lineValue: unknown, index: number): OutboundLabelLine {
  const line = asRecord(lineValue)
  const metadata = getMetadataContainer(line)
  const internalSku = String(firstDefined(
    line.internalSku,
    metadata.internalSku,
    line.sku,
    metadata.sku,
    '',
  )).trim()
  const expectedQty = toNonNegativeInteger(firstDefined(
    line.expectedQty,
    metadata.expectedQty,
    line.expectedQuantity,
    metadata.expectedQuantity,
    line.qty,
    line.quantity,
    metadata.qty,
    metadata.quantity,
  ))
  let unitIndices = readUnitIndices(line, metadata)
  const croppedLabelCount = readLabelCount(line, metadata, unitIndices)

  if (!unitIndices.length && croppedLabelCount > 0) {
    unitIndices = Array.from({ length: croppedLabelCount }, (_, unitIndex) => unitIndex + 1)
  }

  const mappingFlag = readReadyFlag(firstDefined(
    line.mappingReady,
    metadata.mappingReady,
    line.skuMappingReady,
    metadata.skuMappingReady,
    line.mapped,
    metadata.mapped,
    line.mappingStatus,
    metadata.mappingStatus,
  ))
  const labelFlag = readReadyFlag(firstDefined(
    line.labelReady,
    metadata.labelReady,
    line.labelsReady,
    metadata.labelsReady,
    line.ready,
    metadata.ready,
    line.labelStatus,
    metadata.labelStatus,
  ))
  const countMatches = expectedQty > 0 && croppedLabelCount === expectedQty
  const mappingReady = mappingFlag ?? croppedLabelCount > 0
  const labelReady = labelFlag ?? croppedLabelCount > 0

  return {
    key: `${internalSku || 'line'}-${index}`,
    internalSku: internalSku || '—',
    expectedQty,
    croppedLabelCount,
    mappingReady,
    labelReady,
    countMatches,
    printable: countMatches && mappingReady && labelReady,
    unitIndices,
  }
}

function getAttachmentLabelLines(detail: UnknownRecord) {
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : []
  const labelsBySku = new Map<string, {
    sku: string
    croppedLabelCount: number
    mappingReady: boolean
    labelReady: boolean
    unitIndices: number[]
  }>()

  attachments.forEach((attachmentValue) => {
    const attachment = asRecord(attachmentValue)
    const fileType = String(attachment.fileType || '').replace(/[_-]/g, '').toLowerCase()
    const sku = String(firstDefined(attachment.internalSku, attachment.sku, '')).trim()
    if (!['skulabel', 'unitlabel', 'productlabel'].includes(fileType) || !sku) return

    const key = sku.toLowerCase()
    const line = labelsBySku.get(key) ?? {
      sku,
      croppedLabelCount: 0,
      mappingReady: true,
      labelReady: true,
      unitIndices: [],
    }
    line.croppedLabelCount += 1
    const unitIndex = Number(attachment.unitIndex)
    if (Number.isInteger(unitIndex) && unitIndex >= 0) {
      line.unitIndices.push(unitIndex)
    }
    labelsBySku.set(key, line)
  })

  return [...labelsBySku.values()].map(line => ({
    ...line,
    unitIndices: [...new Set(line.unitIndices)].sort((a, b) => a - b),
  }))
}

function getOrderLabelLines(detail: UnknownRecord) {
  const labelMetadata = asRecord(firstDefined(
    detail.outboundLabelMetadata,
    detail.labelMetadata,
    detail.platformLabelMetadata,
    detail.skuLabelMetadata,
    detail.outboundLabels,
    detail.platformLabels,
  ))
  return firstArray(
    detail.labelLines,
    detail.unitLabelLines,
    detail.skuLabels,
    labelMetadata.items,
    labelMetadata.lines,
    labelMetadata.skus,
    getAttachmentLabelLines(detail),
  )
}

function lineSku(value: unknown) {
  const line = asRecord(value)
  return String(firstDefined(line.internalSku, line.sku, '')).trim().toLowerCase()
}

function mergeOrderItemsWithLabels(orderItems: unknown[], labelLines: unknown[]) {
  if (!orderItems.length) return labelLines
  const labelsBySku = new Map<string, unknown>()
  labelLines.forEach((line) => {
    const sku = lineSku(line)
    if (sku) labelsBySku.set(sku, line)
  })

  return orderItems.map((item, index) => {
    const itemRecord = asRecord(item)
    const positionalLabel = asRecord(labelLines[index])
    const positionalFallback = lineSku(positionalLabel) ? undefined : positionalLabel
    const labelRecord = asRecord(
      labelsBySku.get(lineSku(item)) ?? positionalFallback,
    )
    return { ...itemRecord, ...labelRecord }
  })
}

export function buildOutboundLabelSummary(detailValue: unknown): OutboundLabelSummary {
  const detail = asRecord(detailValue)
  const orderItems = Array.isArray(detail.items) ? detail.items : []
  const orderLabelLines = getOrderLabelLines(detail)
  const mergedLines = mergeOrderItemsWithLabels(orderItems, orderLabelLines)
  const lines = mergedLines.map(normalizeLine)
  const hasLabelMetadata = orderLabelLines.length > 0
    || mergedLines.some(line => lineHasMetadata(asRecord(line)))
    || readReadyFlag(firstDefined(detail.hasUnitLabels, detail.unitLabelsReady)) === true

  const platformText = [
    detail.platform,
    detail.outboundType,
    detail.cargoType,
    detail.platformCode,
  ].filter(Boolean).join(' ').toLowerCase()
  const explicitPlatformText = [
    detail.platform,
    detail.outboundType,
    detail.platformCode,
  ].filter(Boolean).join(' ').toLowerCase()
  const hasExplicitPlatform = explicitPlatformText.length > 0
  const isTakealot = platformText.includes('takealot')
    || (!hasExplicitPlatform && hasLabelMetadata)

  const totalExpectedQty = lines.reduce((sum, line) => sum + line.expectedQty, 0)
  const totalCroppedLabels = lines.reduce((sum, line) => sum + line.croppedLabelCount, 0)

  return {
    isTakealot,
    hasLabelMetadata,
    lines,
    totalExpectedQty,
    totalCroppedLabels,
    allPrintable: isTakealot && lines.length > 0 && lines.every(line => line.printable),
  }
}

export function outboundLabelActionKey(
  orderId: string | number,
  action: OutboundLabelAction,
  sku?: string,
  unitIndex?: number,
) {
  return [orderId, action, sku, unitIndex]
    .filter(value => value !== undefined && value !== '')
    .join(':')
}
