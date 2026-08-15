import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const inv = await prisma.inventory.findFirst({
    where: { sku: 'TK-66105', warehouseCode: 'WMS-JHB-01' },
  })
  const loc = await prisma.warehouseLocation.findFirst({
    where: { warehouseCode: 'WMS-JHB-01', locationCode: 'JHB-A-01-01' },
  })
  if (!inv || !loc) {
    console.error('missing inventory or location', { inv: !!inv, loc: !!loc })
    process.exit(1)
  }
  const existing = await prisma.inventoryLocation.findFirst({
    where: { sku: 'TK-66105', locationId: loc.id },
  })
  if (!existing) {
    await prisma.inventoryLocation.create({
      data: {
        productId: inv.productId,
        sku: inv.sku,
        warehouseCode: 'WMS-JHB-01',
        locationId: loc.id,
        locationCode: loc.locationCode,
        qty: 100,
        inboundNo: 'P6-SETUP',
      },
    })
    console.log('created inventory_location TK-66105 @ JHB-A-01-01 qty=100')
  } else {
    console.log(`already exists qty=${existing.qty}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
