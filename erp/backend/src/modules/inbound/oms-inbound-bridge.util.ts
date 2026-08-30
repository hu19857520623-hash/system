import { PrismaService } from '../../common/prisma/prisma.service'

type OmsLineItem = { sku?: string; name?: string; qty?: number; boxNo?: number }

function parseLineItems(raw: string | null | undefined): OmsLineItem[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapWarehouseCode(warehouse: string | null | undefined) {
  const w = String(warehouse || '').trim().toLowerCase()
  if (!w || w === 'jhb1' || w.includes('jhb')) return 'WMS-JHB-01'
  return warehouse || 'WMS-JHB-01'
}

/** OMS 状态 → ERP 入库单展示态 */
export function mapOmsInboundStatus(status: string) {
  const s = String(status || '').trim()
  if (s === 'draft') return { status: 'oms_draft', displayStatus: 'oms_draft' }
  if (s === 'on_the_way') return { status: 'pending_receipt', displayStatus: 'pending_receipt' }
  if (s === 'receiving') return { status: 'receiving', displayStatus: 'receiving' }
  if (s === 'partial') return { status: 'pending_putaway', displayStatus: 'pending_putaway' }
  if (s === 'shelved' || s === 'completed') return { status: 'completed', displayStatus: 'completed' }
  if (s === 'exception') return { status: 'exception', displayStatus: 'exception' }
  return { status: s || 'pending_receipt', displayStatus: s || 'pending_receipt' }
}

function omsStatusesForErpFilter(status?: string): string[] | null {
  if (!status) return null
  switch (status) {
    case 'pending_receipt':
      return ['on_the_way']
    case 'arrived':
      return []
    case 'receiving':
      return ['receiving']
    case 'pending_putaway':
      return ['partial']
    case 'completed':
      return ['shelved', 'completed']
    case 'exception':
      return ['exception']
    default:
      return [status]
  }
}

function mapOmsInboundRow(r: Record<string, unknown>) {
  const lineItems = parseLineItems(r.lineItems as string | undefined)
  const items = lineItems.map((l, idx) => ({
    id: idx + 1,
    sku: String(l.sku || ''),
    expectedQty: Number(l.qty ?? 0),
    actualQty: 0,
    putawayQty: 0,
    remark: String(l.name || ''),
  }))
  const { status, displayStatus } = mapOmsInboundStatus(String(r.status || ''))
  const createdAtRaw = String(r.createdAt || '')
  const createdAt = createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw))
    ? new Date(createdAtRaw)
    : new Date()
  return {
    id: `oms-${r.id}`,
    inboundNo: String(r.inboundNo || ''),
    warehouseCode: mapWarehouseCode(r.warehouse as string | undefined),
    warehouseNo: '',
    trackingNo: String(r.trackingNo || '') || null,
    status,
    displayStatus,
    remark: `[OMS:${r.customerCode || ''}] ${String(r.remark || '').trim()}`.trim(),
    omsCustomerCode: String(r.customerCode || ''),
    omsCustomerName: String(r.customerName || ''),
    omsInboundType: String(r.inboundType || ''),
    omsSource: String(r.source || ''),
    items,
    totalQty: Number(r.totalQty ?? items.reduce((s, i) => s + i.expectedQty, 0)),
    dataSource: 'oms' as const,
    dataSourceLabel: status === 'oms_draft' ? 'OMS·草稿' : 'OMS·客户',
    readOnly: true,
    sortKey: createdAt.getTime(),
    createdAt,
    updatedAt: createdAt,
  }
}

export async function fetchOmsInboundRows(
  prisma: PrismaService,
  filters: { keyword?: string; status?: string },
) {
  const conditions: string[] = ['1=1']
  const params: unknown[] = []

  const omsStatuses = omsStatusesForErpFilter(filters.status?.trim())
  if (omsStatuses !== null) {
    if (!omsStatuses.length) return []
    conditions.push(`(${omsStatuses.map(() => 'i.status = ?').join(' OR ')})`)
    params.push(...omsStatuses)
  } else {
    // 全部：含 OMS 草稿
  }

  const keyword = filters.keyword?.trim()
  if (keyword) {
    conditions.push('(i.inboundNo LIKE ? OR i.trackingNo LIKE ? OR i.referenceNo LIKE ? OR i.skuHint LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like)
  }

  const sql = `
    SELECT i.*, c.code AS customerCode, c.name AS customerName
    FROM oms_inboundorder i
    LEFT JOIN oms_customeraccount c ON c.id = i.customerId
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.createdAt DESC
    LIMIT 5000
  `
  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
    return rows.map(mapOmsInboundRow)
  } catch {
    return []
  }
}

export function mergeInboundPaginate(
  lists: Array<Array<{ sortKey?: number; inboundNo?: string }>>,
  page: number,
  pageSize: number,
) {
  const merged = lists.flat().sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0))
  const total = merged.length
  const items = merged.slice((page - 1) * pageSize, page * pageSize)
  return { items, total }
}
