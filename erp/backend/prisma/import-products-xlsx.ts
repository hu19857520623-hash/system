/**
 * 从 Takealot/WMS 产品导出 Excel 导入商品主数据
 * 用法: npx ts-node prisma/import-products-xlsx.ts [xlsx路径]
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'

const DEFAULT_XLSX =
  'c:\\Users\\15693\\Desktop\\tkl7月2日11点jhb\\ntgenw6_产品导出_b164d20c314416fd7a5c9ba22d126f03.xlsx'

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function parseNum(v: unknown): number | undefined {
  const s = cellStr(v)
  if (!s || s === '0' || s === '0.000') return undefined
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function parseSupplier(raw: string): { code: string; name: string } | null {
  const s = cellStr(raw)
  if (!s) return null
  const m = s.match(/^([^[\]]+)\[([^\]]+)\]$/)
  if (m) return { code: m[1].trim(), name: m[2].trim() }
  return { code: s.slice(0, 30), name: s }
}

function firstImageUrl(raw: string): string | undefined {
  const s = cellStr(raw)
  if (!s) return undefined
  return s.split(',')[0].trim().slice(0, 500) || undefined
}

function buildCategory(row: Record<string, unknown>): string | undefined {
  const parts = ['一级品类', '二级品类', '三级品类']
    .map((k) => cellStr(row[k]))
    .filter(Boolean)
  if (!parts.length) return undefined
  return parts.join(' / ').slice(0, 50)
}

function mapProductStatus(salesStatus: string): string {
  const s = cellStr(salesStatus)
  if (!s || s.includes('在售') || s.includes('上架')) return 'active'
  if (s.includes('下架') || s.includes('清货') || s.includes('停售')) return 'inactive'
  return 'active'
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

async function main() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX
  console.log(`读取 Excel: ${xlsxPath}`)

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets['产品信息'] || wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('未找到工作表「产品信息」')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  if (!rows.length) throw new Error('Excel 无数据行')

  const prisma = new PrismaClient()
  const users = await prisma.sysUser.findMany({ select: { id: true, realName: true, username: true } })

  function resolveUser(name: string): bigint | undefined {
    const key = cellStr(name)
    if (!key) return undefined
    const hit = users.find(
      (u) => u.realName === key || u.realName.includes(key) || key.includes(u.realName),
    )
    return hit?.id
  }

  const supplierCache = new Map<string, bigint>()
  async function ensureSupplier(raw: string): Promise<bigint | undefined> {
    const parsed = parseSupplier(raw)
    if (!parsed) return undefined
    const cacheKey = parsed.code
    if (supplierCache.has(cacheKey)) return supplierCache.get(cacheKey)

    const existing = await prisma.supplier.findFirst({
      where: { OR: [{ supplierCode: parsed.code }, { supplierName: parsed.name }] },
    })
    if (existing) {
      supplierCache.set(cacheKey, existing.id)
      return existing.id
    }

    const created = await prisma.supplier.create({
      data: {
        supplierCode: trunc(parsed.code, 30),
        supplierName: trunc(parsed.name, 200),
        status: 1,
      },
    })
    supplierCache.set(cacheKey, created.id)
    console.log(`  + 供应商: ${parsed.code} ${parsed.name}`)
    return created.id
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const sku = trunc(cellStr(row['产品SKU']), 30)
    const productName = trunc(cellStr(row['产品名称']), 300)
    if (!sku || !productName) {
      skipped++
      console.warn('  跳过：缺少 SKU 或产品名称', row)
      continue
    }

    const cost =
      parseNum(row['最近单价(RMB)']) ??
      parseNum(row['采购价']) ??
      parseNum(row['采购参考价'])

    const salesStatus = cellStr(row['销售状态'])
    const remarkParts = [
      salesStatus ? `销售状态:${salesStatus}` : '',
      cellStr(row['运营方式']) ? `运营:${cellStr(row['运营方式'])}` : '',
      cellStr(row['商品ID']) ? `商品ID:${cellStr(row['商品ID'])}` : '',
    ].filter(Boolean)

    const supplierId = await ensureSupplier(cellStr(row['供应商']))
    const developerId = resolveUser(cellStr(row['开发负责人']))
    const purchaserId = resolveUser(cellStr(row['默认采购员']))

    const payload = {
      sku,
      productName,
      spec: cellStr(row['规格']) ? trunc(cellStr(row['规格']), 100) : undefined,
      category: buildCategory(row),
      brand: cellStr(row['品牌']) ? trunc(cellStr(row['品牌']), 50) : undefined,
      lengthCm: parseNum(row['包装尺寸-长(cm)']),
      widthCm: parseNum(row['包装尺寸-宽(cm)']),
      heightCm: parseNum(row['包装尺寸-高(cm)']),
      weightKg: parseNum(row['重量']),
      costRmb: cost,
      barcode: cellStr(row['EAN码']) ? trunc(cellStr(row['EAN码']), 50) : undefined,
      imageUrl: firstImageUrl(cellStr(row['图片URL'])),
      status: mapProductStatus(salesStatus),
      syncStatus: 'pending',
      remark: remarkParts.length ? remarkParts.join(' | ') : undefined,
      supplierId,
      developerId,
      purchaserId,
    }

    const exists = await prisma.product.findUnique({ where: { sku } })
    if (exists) {
      await prisma.product.update({
        where: { sku },
        data: payload,
      })
      updated++
      console.log(`  ↻ 更新: ${sku} ${productName}`)
    } else {
      await prisma.product.create({ data: payload })
      created++
      console.log(`  ✓ 新增: ${sku} ${productName}`)
    }
  }

  console.log(`\n完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}，共 ${rows.length} 行`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
