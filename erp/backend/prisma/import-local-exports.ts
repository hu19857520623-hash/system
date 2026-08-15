/**
 * 将 backend/uploads/exports 中可识别的 ERP 导出 CSV 回灌到 MySQL。
 *
 * 用法：
 *   npm run import:local-exports             # 仅校验和预览，不写库
 *   npm run import:local-exports -- --apply  # 校验通过后写入数据库
 *
 * 当前支持：
 * - 库存_*.csv：按 SKU + 仓库更新 inventory；缺失的 SKU 以 CSV 的商品名、规格补建最小商品主数据
 * - 成交客户_*.csv：按线索号更新 lead，并恢复为 deal 状态
 *
 * 导出文件不包含出库流水或成交金额、日期等成交明细；本脚本不会臆造这些数据。
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseCsv } from '../src/common/csv.util'

const prisma = new PrismaClient()
const exportDir = join(__dirname, '../uploads/exports')
const apply = process.argv.includes('--apply')

type CsvRow = Record<string, string>

function readCsv(filePath: string): CsvRow[] {
  const rows = parseCsv(readFileSync(filePath, 'utf8'))
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.trim())
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ''])))
}

function requireValue(row: CsvRow, field: string, fileName: string, rowNo: number) {
  const value = row[field]?.trim()
  if (!value) throw new Error(`${fileName} 第 ${rowNo} 行缺少「${field}」`)
  return value
}

function requireInt(row: CsvRow, field: string, fileName: string, rowNo: number) {
  const value = requireValue(row, field, fileName, rowNo)
  if (!/^-?\d+$/.test(value)) throw new Error(`${fileName} 第 ${rowNo} 行「${field}」不是整数`)
  return Number(value)
}

async function importInventory(fileName: string, rows: CsvRow[]) {
  const requiredFields = ['仓库', 'SKU', '总量', '可用', '锁定']
  for (const field of requiredFields) {
    if (!rows[0] || !(field in rows[0])) throw new Error(`${fileName} 缺少「${field}」列`)
  }

  const prepared = await Promise.all(rows.map(async (row, index) => {
    const rowNo = index + 2
    const warehouseCode = requireValue(row, '仓库', fileName, rowNo)
    const sku = requireValue(row, 'SKU', fileName, rowNo)
    const productName = requireValue(row, '商品名', fileName, rowNo)
    const spec = row['规格'] || null
    const totalQty = requireInt(row, '总量', fileName, rowNo)
    const availableQty = requireInt(row, '可用', fileName, rowNo)
    const lockedQty = requireInt(row, '锁定', fileName, rowNo)
    if (totalQty < 0 || availableQty < 0 || lockedQty < 0) {
      throw new Error(`${fileName} 第 ${rowNo} 行库存数量不能为负数`)
    }
    const warehouse = await prisma.warehouse.findUnique({ where: { warehouseCode }, select: { warehouseCode: true } })
    if (!warehouse) throw new Error(`${fileName} 第 ${rowNo} 行仓库「${warehouseCode}」未在仓库表中找到`)
    return { sku, productName, spec, warehouseCode, totalQty, availableQty, lockedQty }
  }))

  const productBySku = new Map<string, { productName: string; spec: string | null }>()
  for (const item of prepared) {
    const existing = productBySku.get(item.sku)
    if (existing && (existing.productName !== item.productName || existing.spec !== item.spec)) {
      throw new Error(`${fileName} 中 SKU「${item.sku}」对应了不一致的商品信息`)
    }
    productBySku.set(item.sku, { productName: item.productName, spec: item.spec })
  }
  const existingProducts = await prisma.product.findMany({
    where: { sku: { in: [...productBySku.keys()] } },
    select: { sku: true },
  })
  const existingSkus = new Set(existingProducts.map((product) => product.sku))
  const missingProducts = [...productBySku.entries()].filter(([sku]) => !existingSkus.has(sku))

  if (apply) {
    await prisma.$transaction(async (tx) => {
      for (const [sku, product] of missingProducts) {
        await tx.product.create({ data: { sku, productName: product.productName, spec: product.spec } })
      }
      const products = await tx.product.findMany({
        where: { sku: { in: [...productBySku.keys()] } },
        select: { id: true, sku: true },
      })
      const productIdBySku = new Map(products.map((product) => [product.sku, product.id]))
      for (const item of prepared) {
        const productId = productIdBySku.get(item.sku)
        if (!productId) throw new Error(`导入时未找到 SKU「${item.sku}」`)
        await tx.inventory.upsert({
          where: { productId_warehouseCode: { productId, warehouseCode: item.warehouseCode } },
          create: { productId, sku: item.sku, warehouseCode: item.warehouseCode, totalQty: item.totalQty, availableQty: item.availableQty, lockedQty: item.lockedQty },
          update: { sku: item.sku, totalQty: item.totalQty, availableQty: item.availableQty, lockedQty: item.lockedQty },
        })
      }
    })
  }
  return { rows: prepared.length, createdProducts: missingProducts.length }
}

async function importDealLeads(fileName: string, rows: CsvRow[]) {
  const requiredFields = ['线索号', '公司', '联系人', '电话', '来源']
  for (const field of requiredFields) {
    if (!rows[0] || !(field in rows[0])) throw new Error(`${fileName} 缺少「${field}」列`)
  }
  const prepared = rows.map((row, index) => {
    const rowNo = index + 2
    return {
      leadNo: requireValue(row, '线索号', fileName, rowNo),
      companyName: requireValue(row, '公司', fileName, rowNo),
      contactName: row['联系人'] || null,
      contactPhone: row['电话'] || null,
      source: row['来源'] || null,
      status: 'deal',
    }
  })

  if (apply) {
    await prisma.$transaction(prepared.map((item) => prisma.lead.upsert({
      where: { leadNo: item.leadNo },
      create: item,
      update: { companyName: item.companyName, contactName: item.contactName, contactPhone: item.contactPhone, source: item.source, status: item.status },
    })))
  }
  return prepared.length
}

async function main() {
  if (!existsSync(exportDir)) throw new Error(`未找到本地导出目录：${exportDir}`)
  const files = readdirSync(exportDir).filter((file) => file.endsWith('.csv'))
  let inventoryRows = 0
  let createdProducts = 0
  let dealLeadRows = 0

  for (const fileName of files) {
    const rows = readCsv(join(exportDir, fileName))
    if (fileName.startsWith('库存_')) {
      const result = await importInventory(fileName, rows)
      inventoryRows += result.rows
      createdProducts += result.createdProducts
    }
    else if (fileName.startsWith('成交客户_')) dealLeadRows += await importDealLeads(fileName, rows)
    else console.log(`跳过 ${fileName}：不是可回灌的业务数据文件`)
  }

  console.log(`${apply ? '已写入' : '校验通过（未写入）'}：补建商品 ${createdProducts} 条，库存 ${inventoryRows} 条，成交线索 ${dealLeadRows} 条。`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
