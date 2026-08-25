export type MingruiTrackingNode = {
  status?: string
  statusName?: string
  eventTime?: string
  location?: string
  description?: string
}

export type MingruiMilestone = {
  key: string
  label: string
  date: string
  reached: boolean
}

export type MingruiTimelineEntry = {
  key: string
  title: string
  description: string
  dateLabel: string
  sortKey: number
}

const MILESTONE_DEFS = [
  { key: 'booked', label: '已订舱', patterns: [/订舱|booked|book/i] },
  { key: 'picked', label: '已提货', patterns: [/提货|装柜|picked|collect|提柜(?!\/入仓)/i] },
  { key: 'departed', label: '已离港', patterns: [/离港|开船|depart|sail|on board|离泊/i] },
  { key: 'arrived', label: '已到港', patterns: [/到港|arriv|ata|抵港|已到港/i] },
  { key: 'transship', label: '已转运(提柜/入仓)', patterns: [/转运|入仓|签入|warehouse|提柜\/入仓|warehouse/i] },
  { key: 'delivered', label: '已派送', patterns: [/派送|deliver|签收|pod|已派送/i] },
] as const

function nodeHaystack(node: MingruiTrackingNode) {
  return [node.statusName, node.status, node.description, node.location].filter(Boolean).join(' ')
}

function parseSortKey(value?: string): number {
  if (!value) return 0
  const normalized = value.trim().replace('年', '-').replace('月', '-').replace('日', '')
  const d = new Date(normalized.includes('T') ? normalized : normalized.replace(/\//g, '-'))
  const ts = d.getTime()
  if (Number.isFinite(ts) && !Number.isNaN(ts)) return ts
  const m = value.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

export function fmtStepDate(value?: string) {
  if (!value) return ''
  const ts = parseSortKey(value)
  if (!ts) return value.slice(0, 10)
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtDetailDate(value?: string) {
  if (!value) return ''
  const ts = parseSortKey(value)
  if (!ts) return value
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function matchMilestone(node: MingruiTrackingNode, patterns: RegExp[]) {
  const hay = nodeHaystack(node)
  return patterns.some((p) => p.test(hay))
}

export function buildMilestones(nodes: MingruiTrackingNode[]): MingruiMilestone[] {
  const sorted = [...nodes].sort((a, b) => parseSortKey(a.eventTime) - parseSortKey(b.eventTime))
  return MILESTONE_DEFS.map((def) => {
    const hit = sorted.find((node) => matchMilestone(node, [...def.patterns]))
    return {
      key: def.key,
      label: def.label,
      date: hit?.eventTime ? fmtStepDate(hit.eventTime) : '',
      reached: Boolean(hit),
    }
  })
}

export function buildTimelineEntries(
  nodes: MingruiTrackingNode[],
  orderInfo?: { jobNum?: string; trackingId?: string; expressTracking?: string },
): MingruiTimelineEntry[] {
  const entries: MingruiTimelineEntry[] = []
  if (orderInfo?.jobNum || orderInfo?.trackingId || orderInfo?.expressTracking) {
    const parts = [
      orderInfo.jobNum ? `Job#: ${orderInfo.jobNum}` : '',
      orderInfo.trackingId ? `Tracking Id#: ${orderInfo.trackingId}` : '',
      orderInfo.expressTracking ? `Express Tracking#: ${orderInfo.expressTracking}` : '',
    ].filter(Boolean)
    entries.push({
      key: 'order-info',
      title: '订单信息',
      description: parts.join('  '),
      dateLabel: '',
      sortKey: 0,
    })
  }

  for (const [idx, node] of nodes.entries()) {
    const title = node.statusName || node.status || '状态更新'
    const description = [node.description, node.location].filter(Boolean).join(' · ') || title
    entries.push({
      key: `${title}-${node.eventTime || idx}`,
      title,
      description,
      dateLabel: fmtDetailDate(node.eventTime),
      sortKey: parseSortKey(node.eventTime) || idx + 1,
    })
  }

  return entries
    .filter((e) => e.key !== 'order-info' || e.description)
    .sort((a, b) => {
      if (a.key === 'order-info') return -1
      if (b.key === 'order-info') return 1
      return a.sortKey - b.sortKey
    })
}

export function pickTrackingId(shipment: Record<string, unknown> | null | undefined) {
  if (!shipment) return ''
  const raw = shipment.raw as Record<string, unknown> | undefined
  const tracking = raw?.tracking as Record<string, unknown> | undefined
  const shipmentRaw = raw?.shipment as Record<string, unknown> | undefined
  const candidates = [
    tracking?.trackingId,
    tracking?.trackId,
    tracking?.expressTrackingNo,
    shipmentRaw?.trackingId,
    shipmentRaw?.expressTrackingNo,
    shipment.trackingId,
  ]
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim()
  }
  return ''
}
