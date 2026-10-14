import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import catalog from './catalog.generated.json'

const LIMIT = 20
const LOOKUPS = new Set(['Customer', 'CustomerAccount', 'Supplier', 'Warehouse', 'WarehouseZone', 'WarehouseLocation', 'StoreAccount', 'TakealotStore'])
const DOC_FIELDS = new Set(['inboundNo', 'outboundNo', 'returnNo', 'orderNo', 'poNo', 'referenceNo', 'bizRef', 'sourceRef', 'targetId', 'batchNo'])
const SKUS = new Set(['sku', 'internalSku'])
const quote = (value: string) => {
  if (!/^\w+$/.test(value)) throw new Error('Invalid catalog identifier')
  return '`' + value + '`'
}
function safeValue(value: any, key = '', depth = 0): any {
  if (/password|secret|token|authorization|cookie|apiKey/i.test(key)) return '[已隐藏]'
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    if (value.length > 8000) return value.slice(0, 8000) + '…[已截断]'
    if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
      try { return safeValue(JSON.parse(value), key, depth + 1) } catch { /* plain text */ }
    }
    return value.replace(/(Bearer\s+)[\w.\-]+/gi, '$1[已隐藏]')
  }
  if (depth > 12) return '[层级已截断]'
  if (Array.isArray(value)) return value.slice(0, 100).map(v => safeValue(v, key, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValue(v, k, depth + 1)]))
  return value
}

@Injectable()
export class FlowDebugService {
  constructor(private readonly prisma: PrismaService) {}
  catalog() { return catalog }

  async trace(q: { orderNo?: string; customerCode?: string; sku?: string }) {
    const orderNo = String(q.orderNo || '').trim()
    const customerCode = String(q.customerCode || '').trim().toUpperCase()
    const sku = String(q.sku || '').trim()
    if ((!orderNo && !sku) || [orderNo, customerCode, sku].some(v => v.length > 100)) throw new BadRequestException('请填写有效单号，或客户代码及 SKU（最多 100 字）')
    if (sku && !customerCode) throw new BadRequestException('按 SKU 查询时必须填写客户代码，避免混淆不同客户库存')
    const internalSku = sku && (sku.toUpperCase().startsWith(customerCode + '-') ? sku : customerCode + '-' + sku)
    const found = new Map<string, any[]>()
    const outcomes = new Map<string, any>()
    let queries = 0
    // Follow schema foreign keys, never infer that identical customer IDs mean the same shipment.
    for (let round = 0; round < 4; round++) {
      const snapshot = new Map(found)
      let changed = false
      for (const table of catalog.tables) {
        const key = table.system + ':' + table.model
        const clauses: string[] = []; const args: any[] = []
        const add = (field: string, values: any[]) => {
          const col = table.fields.find(f => f.name === field)
          const usable = [...new Set(values.filter(v => v !== null && v !== undefined).map(String))].slice(0, LIMIT)
          if (!col || !usable.length) return
          clauses.push(`${quote(col.column)} IN (${usable.map(() => '?').join(',')})`); args.push(...usable)
        }
        for (const field of table.fields) {
          if (orderNo && DOC_FIELDS.has(field.name)) add(field.name, [orderNo])
          if (internalSku && SKUS.has(field.name)) add(field.name, [internalSku])
        }
        for (const rel of table.relations) {
          if (LOOKUPS.has(rel.target)) continue
          const parent = snapshot.get(table.system + ':' + rel.target) || []
          if (rel.fields.length === 1) add(rel.fields[0], parent.map(r => r[rel.references[0]]))
        }
        for (const child of catalog.tables.filter(t => t.system === table.system)) {
          if (LOOKUPS.has(child.model) || (table.model === 'Product' && child.model === 'Product')) continue
          for (const rel of child.relations.filter(r => r.target === table.model && r.fields.length === 1)) {
            add(rel.references[0], (snapshot.get(child.system + ':' + child.model) || []).map(r => r[rel.fields[0]]))
          }
        }
        if (!clauses.length) continue
        const signature = JSON.stringify([clauses, args])
        if (outcomes.get(key)?.signature === signature || outcomes.get(key)?.state === 'unavailable') continue
        queries++
        try {
          const selects = table.fields.map(f => `${quote(f.column)} AS ${quote(f.name)}`).join(',')
          const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT ${selects} FROM ${quote(table.table)} WHERE (${clauses.join(' OR ')}) LIMIT ${LIMIT + 1}`, ...args)
          const previous = snapshot.get(key) || []
          const merged = new Map([...previous, ...rows].map(r => [String(r.id ?? JSON.stringify(safeValue(r))), r]))
          const values = [...merged.values()].slice(0, LIMIT)
          if (values.length !== previous.length) changed = true
          found.set(key, values)
          outcomes.set(key, { signature, state: 'ok', truncated: rows.length > LIMIT || merged.size > LIMIT })
        } catch (error: any) {
          const missing = /doesn't exist|Unknown column|1146|1054/i.test(String(error?.message))
          if (!missing) throw error
          outcomes.set(key, { state: 'unavailable', message: '线上表或字段与当前源码不一致，请核对迁移', signature })
        }
      }
      if (!changed) break
    }
    const sections = catalog.tables.flatMap(table => {
      const key = table.system + ':' + table.model; const rows = found.get(key) || []; const outcome = outcomes.get(key)
      if (!rows.length && outcome?.state !== 'unavailable') return []
      return [{ system: table.system, stage: table.stage, model: table.model, table: table.table, state: outcome?.state, truncated: !!outcome?.truncated, message: outcome?.message, rows: safeValue(rows) }]
    })
    return { query: { orderNo, customerCode, sku, internalSku }, capturedAt: new Date().toISOString(), limitPerTable: LIMIT, queries, sections, notes: ['按精确单号、内部 SKU 和 schema 外键查找相关记录；关联不等于已发生业务流转。', 'ERP 与 OMS 状态和库存分别展示，仅用于对照，不相加。', '最多展开 4 层关系；每表最多 20 条，长字段和附件可能截断。'] }
  }
}
