import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { FileStoreService } from '../../common/file-store.service'
import { OperationLogService } from '../operation-log/operation-log.service'
import { operationActionLabel, operationModuleLabel } from '../operation-log/operation-log.constants'
import { parseProductsImportCsv } from './products-import.util'
import { buildProductRemark } from '../../common/oms-sync-meta.util'
import { buildInternalSku } from '../../common/sku-code.util'
import { CosObjectUrlService } from '../../common/cos-object-url.service'

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const MAX_PRODUCT_IMAGES = 20

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private opLog: OperationLogService,
    private cosUrls: CosObjectUrlService,
  ) {}

  private buildImageList(
    productId: number,
    dbImages: { id: bigint; imageUrl: string }[],
    legacyUrl?: string | null,
  ) {
    const images = dbImages
      .map((img) => ({ id: Number(img.id), imageUrl: this.cosUrls.resolve(img.imageUrl) }))
      .filter((img) => Boolean(img.imageUrl))
    if (images.length) {
      return {
        images,
        imageUrls: images.map((img) => img.imageUrl),
        imageUrl: images[0].imageUrl,
      }
    }
    const resolvedLegacyUrl = legacyUrl ? this.cosUrls.resolve(legacyUrl) : ''
    if (resolvedLegacyUrl) {
      return {
        images: [{ id: null, imageUrl: resolvedLegacyUrl }],
        imageUrls: [resolvedLegacyUrl],
        imageUrl: resolvedLegacyUrl,
      }
    }
    return { images: [], imageUrls: [], imageUrl: null }
  }

  private async migrateLegacyImages(productId: bigint, legacyUrl?: string | null) {
    if (!legacyUrl) return
    const count = await this.prisma.productImage.count({ where: { productId } })
    if (count > 0) return
    await this.prisma.productImage.create({
      data: { productId, imageUrl: legacyUrl, sortOrder: 0 },
    })
  }

  private async syncProductCover(productId: bigint) {
    const first = await this.prisma.productImage.findFirst({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    await this.prisma.product.update({
      where: { id: productId },
      data: { imageUrl: first?.imageUrl ?? null },
    })
  }

  private async loadProductHistory(sku: string) {
    const rows = await this.prisma.operationLog.findMany({
      where: { targetType: 'product', targetId: sku },
      orderBy: { id: 'desc' },
      take: 50,
    })
    return rows.map((row) => ({
      time: fmtTime(row.createdAt),
      operator: row.operatorName || '—',
      role: operationModuleLabel(row.module),
      action: operationActionLabel(row.action),
      detail: this.formatHistoryDetail(row.detail),
    }))
  }

  private formatHistoryDetail(detail: unknown): string {
    if (!detail) return ''
    if (typeof detail === 'string') return detail
    if (typeof detail !== 'object') return String(detail)
    const obj = detail as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (obj.changes && typeof obj.changes === 'object') {
      const changes = obj.changes as Record<string, { from?: unknown; to?: unknown }>
      const parts = Object.entries(changes).map(([key, val]) => {
        const label = key === 'costRmb' ? '采购成本'
          : key === 'seaFreightPerUnit' ? '海运费用/件'
          : key === 'domesticFeePerUnit' ? '国内运费/件'
          : key
        return `${label}: ${val.from ?? '—'} → ${val.to ?? '—'}`
      })
      if (parts.length) return parts.join('；')
    }
    try {
      return JSON.stringify(obj)
    } catch {
      return ''
    }
  }

  private resolveCostFields(row: any, pricing?: { seaFreight: any; domesticFee: any } | null) {
    const purchaseCostRmb = num(row.costRmb)
    const seaFreightPerUnit = num(row.seaFreightPerUnit) || num(pricing?.seaFreight)
    const domesticFeePerUnit = num(row.domesticFeePerUnit) || num(pricing?.domesticFee)
    const totalCostRmb = Math.round((purchaseCostRmb + seaFreightPerUnit + domesticFeePerUnit) * 100) / 100
    return { purchaseCostRmb, seaFreightPerUnit, domesticFeePerUnit, totalCostRmb }
  }

  private async enrichProducts(rows: any[]) {
    if (!rows.length) return []
    const skus = rows.map((r) => r.sku).filter(Boolean) as string[]
    const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean))] as bigint[]
    const productIds = rows.map((r) => r.id) as bigint[]

    const [suppliers, devBySku, poItems, productImages, pricingRows] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, supplierName: true } })
        : [],
      skus.length
        ? this.prisma.productDev.findMany({
            where: { sku: { in: skus }, status: 'approved', applicantId: { not: null } },
            select: { sku: true, applicantId: true },
          })
        : [],
      skus.length
        ? this.prisma.purchaseOrderItem.findMany({
            where: { sku: { in: skus } },
            select: { sku: true, order: { select: { purchaserId: true, createdAt: true } } },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      productIds.length
        ? this.prisma.productImage.findMany({
            where: { productId: { in: productIds } },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, productId: true, imageUrl: true },
          })
        : [],
      skus.length
        ? this.prisma.productPricing.findMany({
            where: { sku: { in: skus } },
            select: { sku: true, seaFreight: true, domesticFee: true },
          })
        : [],
    ])

    const imagesByProduct = new Map<number, { id: bigint; imageUrl: string }[]>()
    for (const img of productImages) {
      const pid = Number(img.productId)
      if (!imagesByProduct.has(pid)) imagesByProduct.set(pid, [])
      imagesByProduct.get(pid)!.push({ id: img.id, imageUrl: img.imageUrl })
    }

    const devSkuMap = new Map<string, bigint>(devBySku.map((d) => [d.sku!, d.applicantId!] as [string, bigint]))
    const purchaserSkuMap = new Map<string, bigint>()
    for (const item of poItems) {
      const pid = item.order?.purchaserId
      if (pid && !purchaserSkuMap.has(item.sku)) purchaserSkuMap.set(item.sku, pid)
    }

    const userIds = [
      ...new Set(
        rows.flatMap((r) => {
          const ids: bigint[] = []
          if (r.developerId) ids.push(r.developerId)
          else {
            const devId = devSkuMap.get(r.sku)
            if (devId) ids.push(devId)
          }
          if (r.purchaserId) ids.push(r.purchaserId)
          else {
            const poPurchaserId = purchaserSkuMap.get(r.sku)
            if (poPurchaserId) ids.push(poPurchaserId)
          }
          return ids
        }),
      ),
    ] as bigint[]

    const users = userIds.length
      ? await this.prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true } })
      : []

    const supMap = new Map<number, string>(suppliers.map((s) => [Number(s.id), s.supplierName] as [number, string]))
    const userMap = new Map<number, string>(users.map((u) => [Number(u.id), u.realName] as [number, string]))
    const pricingMap = new Map<string, { seaFreight: unknown; domesticFee: unknown }>()
    for (const p of pricingRows) pricingMap.set(p.sku, p)

    return rows.map((row) => {
      const developerId = row.developerId ?? devSkuMap.get(row.sku) ?? null
      const purchaserId = row.purchaserId ?? purchaserSkuMap.get(row.sku) ?? null
      const imageMeta = this.buildImageList(
        Number(row.id),
        imagesByProduct.get(Number(row.id)) || [],
        row.imageUrl,
      )
      const costFields = this.resolveCostFields(row, pricingMap.get(row.sku))
      return {
        id: Number(row.id),
        sku: row.sku,
        spu: row.spu,
        productName: row.productName,
        spec: row.spec,
        category: row.category,
        brand: row.brand,
        lengthCm: row.lengthCm,
        widthCm: row.widthCm,
        heightCm: row.heightCm,
        weightKg: row.weightKg,
        costRmb: row.costRmb,
        seaFreightPerUnit: costFields.seaFreightPerUnit,
        domesticFeePerUnit: costFields.domesticFeePerUnit,
        purchaseCostRmb: costFields.purchaseCostRmb,
        totalCostRmb: costFields.totalCostRmb,
        barcode: row.barcode,
        imageUrl: imageMeta.imageUrl,
        imageUrls: imageMeta.imageUrls,
        images: imageMeta.images,
        takealotUrl: row.takealotUrl,
        developerId: developerId ? Number(developerId) : null,
        purchaserId: purchaserId ? Number(purchaserId) : null,
        supplierId: row.supplierId ? Number(row.supplierId) : null,
        status: row.status,
        syncStatus: row.syncStatus,
        remark: row.remark,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        developerName: developerId ? userMap.get(Number(developerId)) || null : null,
        purchaserName: purchaserId ? userMap.get(Number(purchaserId)) || null : null,
        supplierName: row.supplierId ? supMap.get(Number(row.supplierId)) || null : null,
      }
    })
  }

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.keyword) {
      where.OR = [{ sku: { contains: q.keyword } }, { productName: { contains: q.keyword } }]
    }
    if (q.status) where.status = q.status
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.product.count({ where }),
    ])
    const items = await this.enrichProducts(rows)
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('商品不存在')
    await this.migrateLegacyImages(row.id, row.imageUrl)
    const fresh = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    const [item] = await this.enrichProducts([fresh!])
    const history = await this.loadProductHistory(item.sku)
    return { ...item, history }
  }

  private buildUserLookup(users: { id: bigint; username: string; realName: string | null }[]) {
    const map = new Map<string, bigint>()
    for (const u of users) {
      map.set(u.username.toLowerCase(), u.id)
      if (u.realName) map.set(u.realName.toLowerCase(), u.id)
    }
    return map
  }

  async importFromCsv(content: string, operatorId?: number) {
    let parsed: ReturnType<typeof parseProductsImportCsv>
    try {
      parsed = parseProductsImportCsv(content)
    } catch (e: any) {
      throw new BadRequestException(e.message || '导入文件格式错误')
    }
    if (!parsed.length) throw new BadRequestException('文件为空或没有有效数据行')

    const [developers, purchasers, suppliers] = await Promise.all([
      this.prisma.sysUser.findMany({
        where: { status: 1, roleCode: { in: ['viewer', 'dev_manager'] } },
        select: { id: true, username: true, realName: true },
      }),
      this.prisma.sysUser.findMany({
        where: { status: 1, roleCode: 'purchaser' },
        select: { id: true, username: true, realName: true },
      }),
      this.prisma.supplier.findMany({ select: { id: true, supplierName: true } }),
    ])

    const developerByKey = this.buildUserLookup(developers)
    const purchaserByKey = this.buildUserLookup(purchasers)
    const supplierByKey = new Map<string, bigint>()
    for (const s of suppliers) {
      supplierByKey.set(s.supplierName.toLowerCase(), s.id)
    }

    let ok = 0
    let fail = 0
    for (const row of parsed) {
      try {
        let developerId: number | undefined
        if (row.developerKey) {
          const id = developerByKey.get(row.developerKey.toLowerCase())
          if (!id) { fail++; continue }
          developerId = Number(id)
        }
        let purchaserId: number | undefined
        if (row.purchaserKey) {
          const id = purchaserByKey.get(row.purchaserKey.toLowerCase())
          if (!id) { fail++; continue }
          purchaserId = Number(id)
        }
        let supplierId: number | undefined
        if (row.supplierKey) {
          const id = supplierByKey.get(row.supplierKey.toLowerCase())
          if (!id) { fail++; continue }
          supplierId = Number(id)
        }
        await this.create({
          sku: row.sku,
          spu: row.spu,
          productName: row.productName,
          spec: row.spec,
          costRmb: row.costRmb,
          lengthCm: row.lengthCm,
          widthCm: row.widthCm,
          heightCm: row.heightCm,
          weightKg: row.weightKg,
          barcode: row.barcode,
          developerId,
          purchaserId,
          supplierId,
          status: row.status,
        }, operatorId)
        ok++
      } catch {
        fail++
      }
    }
    return { imported: ok, failed: fail }
  }

  async create(data: any, operatorId?: number) {
    const sku = String(data.sku || '').trim()
    const productName = String(data.productName || '').trim()
    if (!sku) throw new BadRequestException('请填写 SKU')
    if (!productName) throw new BadRequestException('请填写商品名称')

    const [existingProduct, existingDev] = await Promise.all([
      this.prisma.product.findUnique({ where: { sku } }),
      this.prisma.productDev.findFirst({ where: { sku } }),
    ])
    if (existingProduct) throw new BadRequestException(`重复 SKU：${sku}`)
    if (existingDev) throw new BadRequestException(`重复 SKU：${sku}`)

    const toDecimal = (v: unknown) => {
      if (v == null || v === '') return undefined
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }

    const status = String(data.status || 'active')
    if (!['active', 'pending', 'inactive'].includes(status)) {
      throw new BadRequestException('无效的商品状态')
    }

    const row = await this.prisma.product.create({
      data: {
        sku,
        productName,
        customerSku: data.customerSku?.trim() || null,
        spu: data.spu?.trim() || null,
        spec: data.spec?.trim() || null,
        category: data.category?.trim() || null,
        brand: data.brand?.trim() || null,
        lengthCm: toDecimal(data.lengthCm),
        widthCm: toDecimal(data.widthCm),
        heightCm: toDecimal(data.heightCm),
        weightKg: toDecimal(data.weightKg),
        costRmb: toDecimal(data.costRmb) ?? 0,
        barcode: data.barcode?.trim() || null,
        declaredNameEn: data.declaredNameEn?.trim() || null,
        declaredNameCn: data.declaredNameCn?.trim() || null,
        unit: data.unit?.trim() || null,
        hasBattery: Boolean(data.hasBattery),
        imageUrl: typeof data.imageUrl === 'string' && data.imageUrl.trim() && data.imageUrl.trim().length <= 500
          ? data.imageUrl.trim()
          : null,
        takealotUrl: data.takealotUrl?.trim() || null,
        developerId: data.developerId ? BigInt(data.developerId) : undefined,
        purchaserId: data.purchaserId ? BigInt(data.purchaserId) : undefined,
        supplierId: data.supplierId ? BigInt(data.supplierId) : undefined,
        status,
        syncStatus: 'pending',
        remark: data.remark?.trim() || null,
      },
    })

    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'create',
      targetType: 'product',
      targetId: row.sku,
      detail: { productName: row.productName, status: row.status },
    })

    const [item] = await this.enrichProducts([row])
    return item
  }

  async update(id: number, data: any, operatorId?: number) {
    const before = await this.detail(id)
    const patch: Record<string, unknown> = {}
    const assign = (key: string, transform?: (v: unknown) => unknown) => {
      if (data[key] === undefined) return
      patch[key] = transform ? transform(data[key]) : data[key]
    }
    assign('productName', (v) => String(v || '').trim())
    assign('spu', (v) => (v == null || v === '' ? null : String(v).trim()))
    assign('spec', (v) => (v == null || v === '' ? null : String(v).trim()))
    assign('barcode', (v) => (v == null || v === '' ? null : String(v).trim()))
    assign('remark', (v) => (v == null || v === '' ? null : String(v).trim()))
    assign('costRmb', (v) => num(v))
    assign('lengthCm', (v) => (v == null || v === '' ? null : num(v)))
    assign('widthCm', (v) => (v == null || v === '' ? null : num(v)))
    assign('heightCm', (v) => (v == null || v === '' ? null : num(v)))
    assign('weightKg', (v) => (v == null || v === '' ? null : num(v)))
    if (data.developerId !== undefined) patch.developerId = data.developerId ? BigInt(data.developerId) : null
    if (data.purchaserId !== undefined) patch.purchaserId = data.purchaserId ? BigInt(data.purchaserId) : null
    if (data.supplierId !== undefined) patch.supplierId = data.supplierId ? BigInt(data.supplierId) : null

    const row = await this.prisma.product.update({ where: { id: BigInt(id) }, data: patch })
    const changes: Record<string, unknown> = {}
    for (const key of ['productName', 'spec', 'costRmb', 'seaFreightPerUnit', 'domesticFeePerUnit', 'weightKg', 'lengthCm', 'widthCm', 'heightCm', 'remark', 'status']) {
      const prev = (before as any)[key]
      const next = (row as any)[key]
      if (prev !== next && next !== undefined) {
        changes[key] = { from: prev, to: next }
      }
    }
    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'update',
      targetType: 'product',
      targetId: row.sku,
      detail: { productName: row.productName, changes },
    })
    const [item] = await this.enrichProducts([row])
    return item
  }

  async disable(id: number, operatorId?: number) {
    const row = await this.detail(id)
    if (row.status === 'inactive') return row
    const updated = await this.prisma.product.update({ where: { id: BigInt(id) }, data: { status: 'inactive' } })
    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'disable',
      targetType: 'product',
      targetId: row.sku,
      detail: { message: '商品已禁用' },
    })
    const [item] = await this.enrichProducts([updated])
    return item
  }

  async enable(id: number, operatorId?: number) {
    const row = await this.detail(id)
    if (row.status !== 'inactive') return row
    const updated = await this.prisma.product.update({ where: { id: BigInt(id) }, data: { status: 'active' } })
    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'enable',
      targetType: 'product',
      targetId: row.sku,
      detail: { message: '商品已启用' },
    })
    const [item] = await this.enrichProducts([updated])
    return item
  }

  /** 采购完善主数据后确认生效，方可下采购单 */
  async confirmMaster(id: number, operatorId?: number) {
    const row = await this.detail(id)
    if (row.status !== 'pending') throw new BadRequestException('仅待完善主数据状态可确认')
    if (!row.supplierId) throw new BadRequestException('请填写供应商')
    const cost = row.costRmb != null ? Number(row.costRmb) : 0
    if (!cost || cost <= 0) throw new BadRequestException('请填写采购成本')
    const hasDims = row.lengthCm && row.widthCm && row.heightCm
    const hasWeight = row.weightKg && Number(row.weightKg) > 0
    if (!hasDims && !hasWeight) throw new BadRequestException('请填写包装尺寸或重量')

    const updated = await this.prisma.product.update({
      where: { id: BigInt(id) },
      data: { status: 'active' },
    })
    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'confirm_master',
      targetType: 'product',
      targetId: row.sku,
      detail: { productName: row.productName, supplierId: row.supplierId ? Number(row.supplierId) : null, costRmb: cost },
    })
    const [item] = await this.enrichProducts([updated])
    return item
  }

  async remove(id: number) {
    await this.detail(id)
    await this.prisma.product.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  async findBySku(sku: string) {
    const row = await this.prisma.product.findUnique({ where: { sku } })
    if (!row) throw new NotFoundException('商品不存在')
    return row
  }

  buildSkuLabelHtml(product: any) {
    return `<!DOCTYPE html><html><body>
      <div style="width:50mm;height:30mm;border:1px solid #000;padding:4mm;font-family:Arial,sans-serif">
        <div style="font-size:14px;font-weight:bold">${product.sku}</div>
        <div style="font-size:9px;margin:2mm 0">${product.productName || ''}</div>
        <div style="font-size:8px">${product.spec || ''}</div>
        <div style="font-size:8px;margin-top:2mm">${product.barcode || 'EAN pending'}</div>
      </div>
    </body></html>`
  }

  async getSkuLabel(sku: string) {
    const product = await this.findBySku(sku)
    const html = this.buildSkuLabelHtml(product)
    return {
      fileName: `SKU标签_${sku}.html`,
      content: Buffer.from(html, 'utf-8'),
      mimeType: 'text/html;charset=utf-8',
    }
  }

  async uploadImage(id: number, data: { fileName: string; contentBase64: string }) {
    const product = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    if (!product) throw new NotFoundException('商品不存在')
    await this.migrateLegacyImages(product.id, product.imageUrl)

    const count = await this.prisma.productImage.count({ where: { productId: BigInt(id) } })
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(`最多上传 ${MAX_PRODUCT_IMAGES} 张图片`)
    }

    const buf = Buffer.from(data.contentBase64, 'base64')
    const ext = path.extname(data.fileName || '').toLowerCase() || '.jpg'
    const safeName = `${id}_${Date.now()}${ext}`
    this.files.write('product-images', safeName, buf)
    const imageUrl = `/api/products/images/${safeName}`

    const maxSort = await this.prisma.productImage.aggregate({
      where: { productId: BigInt(id) },
      _max: { sortOrder: true },
    })
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1

    const image = await this.prisma.productImage.create({
      data: { productId: BigInt(id), imageUrl, sortOrder },
    })
    await this.syncProductCover(BigInt(id))

    const productRow = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    await this.opLog.log({
      module: 'product',
      action: 'upload_image',
      targetType: 'product',
      targetId: productRow?.sku,
      detail: { message: `上传商品图片 ${data.fileName}` },
    })

    const row = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    const [item] = await this.enrichProducts([row!])
    return { imageId: Number(image.id), imageUrl, images: item.images, imageUrls: item.imageUrls, product: item }
  }

  async deleteImage(productId: number, imageId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: BigInt(productId) } })
    if (!product) throw new NotFoundException('商品不存在')

    const image = await this.prisma.productImage.findFirst({
      where: { id: BigInt(imageId), productId: BigInt(productId) },
    })
    if (!image) throw new NotFoundException('图片不存在')

    if (image.imageUrl.startsWith('/api/products/images/')) {
      const fileName = path.basename(image.imageUrl)
      const relativePath = `product-images/${fileName}`
      if (this.files.exists(relativePath)) {
        const full = path.join(process.cwd(), 'uploads', relativePath)
        try {
          fs.unlinkSync(full)
        } catch { /* ignore */ }
      }
    }

    await this.prisma.productImage.delete({ where: { id: BigInt(imageId) } })
    await this.syncProductCover(BigInt(productId))

    await this.opLog.log({
      module: 'product',
      action: 'delete_image',
      targetType: 'product',
      targetId: product.sku,
      detail: { message: '删除商品图片' },
    })

    const row = await this.prisma.product.findUnique({ where: { id: BigInt(productId) } })
    const [item] = await this.enrichProducts([row!])
    return { images: item.images, imageUrls: item.imageUrls, product: item }
  }

  serveImage(fileName: string, res: Response) {
    const safe = path.basename(fileName)
    const relativePath = `product-images/${safe}`
    if (!this.files.exists(relativePath)) throw new NotFoundException('图片不存在')
    const buf = this.files.read(relativePath)
    const ext = path.extname(safe).toLowerCase()
    if (!IMAGE_MIME[ext]) throw new NotFoundException('图片不存在')
    res.setHeader('Content-Type', IMAGE_MIME[ext])
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(buf)
  }

  /** OMS P2：客户建品 → ERP 商品主数据 */
  async createFromOms(data: any) {
    const customerCode = String(data.customerCode || '').trim()
    const customerSku = String(data.customerSku || data.sku || data.internalSku || '').trim()
    const productName = String(data.productName || data.name || '').trim()
    if (!customerSku) throw new BadRequestException('请填写 SKU')
    if (!productName) throw new BadRequestException('请填写商品名称')

    let sku = String(data.internalSku || data.sku || '').trim()
    if (customerCode && (!sku || sku === customerSku || !sku.toUpperCase().startsWith(`${customerCode.toUpperCase()}-`))) {
      const existing = await this.prisma.product.findMany({
        where: customerCode ? { remark: { contains: `OMS客户:${customerCode}` } } : undefined,
        select: { sku: true },
      })
      sku = buildInternalSku(customerCode, customerSku, existing.map(r => r.sku))
    }
    if (!sku) throw new BadRequestException('无法生成系统 SKU')

    const existing = await this.prisma.product.findUnique({ where: { sku } })
    if (existing) {
      throw new BadRequestException(`重复 SKU：${sku}`)
    }

    const remark = buildProductRemark({
      customerCode: customerCode || undefined,
      userRemark: data.remark,
      meta: {
        declaredNameEn: data.declaredNameEn || data.spec || undefined,
        declaredNameCn: data.declaredNameCn || undefined,
        unit: data.unit || undefined,
        customerSku,
      },
    })

    const item = await this.create(
      {
        sku,
        productName,
        spec: data.spec || data.declaredNameEn || null,
        category: data.category || null,
        brand: data.brand || null,
        barcode: data.barcode || data.customCode || null,
        customerSku,
        declaredNameEn: data.declaredNameEn || data.spec || null,
        declaredNameCn: data.declaredNameCn || null,
        unit: data.unit || null,
        hasBattery: Boolean(data.hasBattery),
        imageUrl: typeof data.image === 'string' && data.image.length <= 500
          ? data.image
          : (typeof data.imageUrl === 'string' && data.imageUrl.length <= 500 ? data.imageUrl : null),
        lengthCm: data.lengthCm,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        weightKg: data.weightKg,
        costRmb: data.costRmb ?? data.declaredValue ?? 0,
        status: 'active',
        remark: remark || null,
      },
      undefined,
    )

    return {
      id: item.id,
      sku: item.sku,
      customerSku,
      productName: item.productName,
      spec: item.spec,
      barcode: item.barcode,
      status: item.status,
      customerCode: customerCode || null,
      declaredNameEn: data.declaredNameEn || null,
      declaredNameCn: data.declaredNameCn || null,
      unit: data.unit || null,
      createdAt: item.createdAt,
    }
  }
}
