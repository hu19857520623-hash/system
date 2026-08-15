import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { OperationLogService } from '../operation-log/operation-log.service'

const LOCATION_STATUSES = new Set(['available', 'disabled', 'locked'])
const PARTITION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function warehouseShortCode(warehouseCode: string) {
  const parts = warehouseCode.split('-').filter(Boolean)
  if (parts[0] === 'WMS' && parts[1]) return parts[1]
  return parts[parts.length - 1] || warehouseCode.slice(0, 6)
}

function extractPartitionCode(zoneCode: string) {
  if (/^[A-Z]$/.test(zoneCode)) return zoneCode
  const m = zoneCode.match(/(?:^|-)([A-Z])(?:-|$)/)
  if (m) return m[1]
  return zoneCode.slice(0, 1).toUpperCase()
}

@Injectable()
export class WarehouseLocationService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  async list(q: { warehouseCode?: string; zoneId?: number; status?: string }) {
    const where: any = {}
    if (q.warehouseCode) where.warehouseCode = q.warehouseCode
    if (q.zoneId) where.zoneId = BigInt(q.zoneId)
    if (q.status) where.status = q.status

    const rows = await this.prisma.warehouseLocation.findMany({
      where,
      include: {
        zone: { select: { zoneCode: true, zoneName: true, zoneType: true } },
        _count: { select: { inventoryItems: true } },
      },
      orderBy: [{ warehouseCode: 'asc' }, { locationCode: 'asc' }],
    })

    const skuCounts = await this.groupSkuCounts(rows.map((r) => Number(r.id)))
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      zoneId: Number(r.zoneId),
      zoneCode: r.zone.zoneCode,
      zoneName: r.zone.zoneName,
      zoneType: r.zone.zoneType,
      skuCount: skuCounts.get(Number(r.id)) ?? 0,
      inventoryLineCount: r._count.inventoryItems,
    }))
  }

  private async groupSkuCounts(locationIds: number[]) {
    const map = new Map<number, number>()
    if (!locationIds.length) return map
    const rows = await this.prisma.inventoryLocation.groupBy({
      by: ['locationId'],
      where: { locationId: { in: locationIds.map((id) => BigInt(id)) }, qty: { gt: 0 } },
      _count: { productId: true },
    })
    rows.forEach((r) => map.set(Number(r.locationId), r._count.productId))
    return map
  }

  async create(data: any, operatorId?: number) {
    const warehouseCode = String(data.warehouseCode || '').trim()
    const locationCode = String(data.locationCode || '').trim()
    const zoneId = Number(data.zoneId)
    if (!warehouseCode || !locationCode || !zoneId) {
      throw new BadRequestException('warehouseCode、locationCode、zoneId 为必填')
    }

    const zone = await this.prisma.warehouseZone.findUnique({ where: { id: BigInt(zoneId) } })
    if (!zone || zone.warehouseCode !== warehouseCode) {
      throw new BadRequestException('库区与仓库不匹配')
    }

    const status = String(data.status || 'available')
    if (!LOCATION_STATUSES.has(status)) throw new BadRequestException('无效的 status')

    const row = await this.prisma.warehouseLocation.create({
      data: {
        warehouseCode,
        locationCode,
        zoneId: BigInt(zoneId),
        aisle: data.aisle || null,
        rack: data.rack || null,
        level: data.level || null,
        bin: data.bin || null,
        maxVolumeCbm: data.maxVolumeCbm != null ? data.maxVolumeCbm : null,
        maxWeightKg: data.maxWeightKg != null ? data.maxWeightKg : null,
        status,
        remark: data.remark || null,
      },
    })
    await this.opLog.log({
      operatorId,
      module: 'warehouse_location',
      action: 'create',
      targetType: 'warehouse_location',
      targetId: locationCode,
      detail: { warehouseCode, zoneId },
    })
    return { ...row, id: Number(row.id), zoneId: Number(row.zoneId) }
  }

  async batchCreate(data: any, operatorId?: number) {
    const warehouseCode = String(data.warehouseCode || '').trim()
    const zoneId = Number(data.zoneId)
    let prefix = String(data.prefix || data.locationCodePrefix || '').trim()
    const startNum = Number(data.startNum ?? data.from ?? 1)
    const endNum = Number(data.endNum ?? data.to ?? startNum)
    const padLength = Number(data.padLength ?? data.pad ?? 2)
    const rackNoRaw = data.rackNo ?? data.rack
    const partitionCodeRaw = data.partitionCode ?? data.partitionLetter

    if (!warehouseCode || !zoneId) {
      throw new BadRequestException('warehouseCode、zoneId 为必填')
    }
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || startNum > endNum) {
      throw new BadRequestException('startNum/endNum 无效')
    }
    if (endNum - startNum + 1 > 200) {
      throw new BadRequestException('单次最多生成 200 个库位')
    }

    const zone = await this.prisma.warehouseZone.findUnique({ where: { id: BigInt(zoneId) } })
    if (!zone || zone.warehouseCode !== warehouseCode) {
      throw new BadRequestException('库区与仓库不匹配')
    }

    const partitionCode = String(partitionCodeRaw || extractPartitionCode(zone.zoneCode)).toUpperCase()
    if (!/^[A-Z]$/.test(partitionCode)) {
      throw new BadRequestException('分区代码须为 A-Z 单字母')
    }
    const rackNo = rackNoRaw != null && String(rackNoRaw).trim() !== ''
      ? String(rackNoRaw).padStart(2, '0')
      : null
    if (!prefix && rackNo) {
      prefix = `${warehouseShortCode(warehouseCode)}-${partitionCode}-${rackNo}-`
    }
    if (!prefix) {
      throw new BadRequestException('请填写编码前缀，或提供货架号以自动生成')
    }

    const codes: string[] = []
    for (let n = startNum; n <= endNum; n++) {
      codes.push(`${prefix}${String(n).padStart(padLength, '0')}`)
    }

    const existing = await this.prisma.warehouseLocation.findMany({
      where: { warehouseCode, locationCode: { in: codes } },
      select: { locationCode: true },
    })
    if (existing.length) {
      throw new BadRequestException(`以下库位已存在：${existing.map((e) => e.locationCode).join(', ')}`)
    }

    const created = await this.prisma.$transaction(
      codes.map((locationCode, idx) => {
        const seq = String(startNum + idx).padStart(padLength, '0')
        return this.prisma.warehouseLocation.create({
          data: {
            warehouseCode,
            locationCode,
            zoneId: BigInt(zoneId),
            aisle: partitionCode,
            rack: rackNo,
            bin: seq,
            status: 'available',
          },
        })
      }),
    )
    await this.opLog.log({
      operatorId,
      module: 'warehouse_location',
      action: 'batch_create',
      targetType: 'warehouse_location',
      targetId: warehouseCode,
      detail: { zoneId, count: created.length, prefix },
    })
    return {
      total: created.length,
      items: created.map((r) => ({ id: Number(r.id), locationCode: r.locationCode })),
    }
  }

  async update(id: number, data: any, operatorId?: number) {
    const row = await this.prisma.warehouseLocation.findUnique({
      where: { id: BigInt(id) },
      include: { _count: { select: { inventoryItems: true } } },
    })
    if (!row) throw new NotFoundException('库位不存在')

    if (data.status === 'disabled' && row._count.inventoryItems > 0) {
      const hasStock = await this.prisma.inventoryLocation.findFirst({
        where: { locationId: BigInt(id), qty: { gt: 0 } },
      })
      if (hasStock) throw new BadRequestException('库位仍有库存，不可停用')
    }

    const status = data.status != null ? String(data.status) : row.status
    if (!LOCATION_STATUSES.has(status)) throw new BadRequestException('无效的 status')

    const updated = await this.prisma.warehouseLocation.update({
      where: { id: BigInt(id) },
      data: {
        aisle: data.aisle !== undefined ? data.aisle : undefined,
        rack: data.rack !== undefined ? data.rack : undefined,
        level: data.level !== undefined ? data.level : undefined,
        bin: data.bin !== undefined ? data.bin : undefined,
        maxVolumeCbm: data.maxVolumeCbm !== undefined ? data.maxVolumeCbm : undefined,
        maxWeightKg: data.maxWeightKg !== undefined ? data.maxWeightKg : undefined,
        status,
        remark: data.remark !== undefined ? data.remark : undefined,
      },
    })
    await this.opLog.log({
      operatorId,
      module: 'warehouse_location',
      action: 'update',
      targetType: 'warehouse_location',
      targetId: row.locationCode,
      detail: { warehouseCode: row.warehouseCode, status },
    })
    return { ...updated, id: Number(updated.id), zoneId: Number(updated.zoneId) }
  }

  async locationInventory(id: number) {
    const loc = await this.prisma.warehouseLocation.findUnique({ where: { id: BigInt(id) } })
    if (!loc) throw new NotFoundException('库位不存在')

    const items = await this.prisma.inventoryLocation.findMany({
      where: { locationId: BigInt(id), qty: { gt: 0 } },
      orderBy: { sku: 'asc' },
    })
    return {
      location: {
        id: Number(loc.id),
        locationCode: loc.locationCode,
        warehouseCode: loc.warehouseCode,
        status: loc.status,
      },
      items: items.map((i) => ({
        ...i,
        id: Number(i.id),
        productId: Number(i.productId),
        locationId: Number(i.locationId),
      })),
      totalQty: items.reduce((s, i) => s + i.qty, 0),
    }
  }

  buildLocationLabelHtml(
    locations: Array<{
      locationCode: string
      warehouseCode: string
      warehouseName?: string | null
      zoneName?: string | null
      zoneCode?: string | null
    }>,
    autoPrint = true,
  ) {
    const blocks = locations.map((loc) => {
      const zoneLabel = loc.zoneName || loc.zoneCode || ''
      const whLabel = loc.warehouseName || loc.warehouseCode
      return `
      <div class="label">
        <div class="wh">${whLabel}</div>
        <div class="zone">${zoneLabel}</div>
        <div class="code">${loc.locationCode}</div>
        <svg class="barcode" jsbarcode-value="${loc.locationCode}" jsbarcode-height="36" jsbarcode-width="1.2" jsbarcode-fontsize="0"></svg>
      </div>`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>库位标签</title>
<style>
@page { size: 60mm 40mm; margin: 0; }
body { margin: 0; font-family: Arial, sans-serif; }
.label {
  width: 60mm; height: 40mm; box-sizing: border-box;
  border: 1px solid #000; padding: 3mm 4mm;
  page-break-after: always; display: flex; flex-direction: column; justify-content: space-between;
}
.wh { font-size: 9px; color: #444; }
.zone { font-size: 10px; color: #666; margin-bottom: 1mm; }
.code { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; font-family: Consolas, monospace; }
.barcode { width: 100%; height: 10mm; }
</style>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
</head><body>
${blocks}
<script>
document.querySelectorAll('.barcode').forEach(function(el) {
  try { JsBarcode(el, el.getAttribute('jsbarcode-value'), { format: 'CODE128', displayValue: false, margin: 0 }); } catch (e) {}
});
${autoPrint ? 'window.onload = function() { setTimeout(function() { window.print(); }, 300); };' : ''}
<\/script>
</body></html>`
  }

  async getLabel(id: number) {
    const loc = await this.prisma.warehouseLocation.findUnique({
      where: { id: BigInt(id) },
      include: { zone: { select: { zoneCode: true, zoneName: true } } },
    })
    if (!loc) throw new NotFoundException('库位不存在')
    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode: loc.warehouseCode } })
    const html = this.buildLocationLabelHtml([{
      locationCode: loc.locationCode,
      warehouseCode: loc.warehouseCode,
      warehouseName: wh?.warehouseName,
      zoneName: loc.zone.zoneName,
      zoneCode: loc.zone.zoneCode,
    }])
    return {
      fileName: `库位标签_${loc.locationCode}.html`,
      content: Buffer.from(html, 'utf-8'),
      mimeType: 'text/html;charset=utf-8',
    }
  }

  async getLabels(q: { ids?: number[]; warehouseCode?: string; zoneId?: number }) {
    let rows: Array<{
      locationCode: string
      warehouseCode: string
      zone: { zoneCode: string; zoneName: string }
    }> = []

    if (q.ids?.length) {
      rows = await this.prisma.warehouseLocation.findMany({
        where: { id: { in: q.ids.map((id) => BigInt(id)) } },
        include: { zone: { select: { zoneCode: true, zoneName: true } } },
        orderBy: { locationCode: 'asc' },
      })
    } else if (q.warehouseCode) {
      const where: any = { warehouseCode: q.warehouseCode }
      if (q.zoneId) where.zoneId = BigInt(q.zoneId)
      rows = await this.prisma.warehouseLocation.findMany({
        where,
        include: { zone: { select: { zoneCode: true, zoneName: true } } },
        orderBy: { locationCode: 'asc' },
      })
    } else {
      throw new BadRequestException('请提供 ids 或 warehouseCode')
    }

    if (!rows.length) throw new NotFoundException('没有可打印的库位')

    const whCodes = [...new Set(rows.map((r) => r.warehouseCode))]
    const warehouses = await this.prisma.warehouse.findMany({
      where: { warehouseCode: { in: whCodes } },
      select: { warehouseCode: true, warehouseName: true },
    })
    const whMap = new Map(warehouses.map((w) => [w.warehouseCode, w.warehouseName]))

    const html = this.buildLocationLabelHtml(rows.map((r) => ({
      locationCode: r.locationCode,
      warehouseCode: r.warehouseCode,
      warehouseName: whMap.get(r.warehouseCode),
      zoneName: r.zone.zoneName,
      zoneCode: r.zone.zoneCode,
    })))

    return {
      fileName: `库位标签_${rows.length}个.html`,
      content: Buffer.from(html, 'utf-8'),
      mimeType: 'text/html;charset=utf-8',
    }
  }

  listPartitionLetters() {
    return PARTITION_LETTERS
  }
}
