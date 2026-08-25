/**
 * 根据图片提取清单，把已上传 COS 的稳定对象 URL 回写到 ERP 产品图片。
 * 默认仅校验；传入 --apply 后替换对应产品的旧图片记录。
 */
import * as fs from 'fs'
import { PrismaClient } from '@prisma/client'

interface ImageManifestRow {
  sku: string
  objectKey: string
}

const APPLY = process.argv.includes('--apply')
const manifestArg = process.argv.find((arg) => arg.startsWith('--manifest='))
const manifestPath = manifestArg?.slice('--manifest='.length)
  || 'D:/all/.codex-tmp/legacy-erp-import/product-images-manifest.json'
function objectReference(key: string) {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('../')) throw new Error(`非法 COS 对象键：${key}`)
  return `cos://${normalized}`
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ImageManifestRow[]
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('图片清单为空')

  const prisma = new PrismaClient()
  try {
    const skus = manifest.map((row) => row.sku)
    const products = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } })
    const productBySku = new Map(products.map((product) => [product.sku, product]))
    const missing = manifest.filter((row) => !productBySku.has(row.sku)).map((row) => row.sku)
    console.log(`图片清单 ${manifest.length}，匹配产品 ${products.length}，缺失产品 ${missing.length}`)
    if (missing.length) console.log(`缺失 SKU：${missing.join(', ')}`)
    if (!APPLY) {
      console.log('当前为校验模式；确认 COS 对象可访问后传入 --apply 回写。')
      return
    }

    let updated = 0
    for (const row of manifest) {
      const product = productBySku.get(row.sku)
      if (!product) continue
      const url = objectReference(row.objectKey)
      await prisma.$transaction([
        prisma.productImage.deleteMany({ where: { productId: product.id } }),
        prisma.productImage.create({ data: { productId: product.id, imageUrl: url, sortOrder: 0 } }),
        prisma.product.update({ where: { id: product.id }, data: { imageUrl: url } }),
      ])
      updated++
    }
    console.log(`已回写 ${updated} 个产品 COS 图片地址。`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
