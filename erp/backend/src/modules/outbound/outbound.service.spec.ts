import { BadRequestException, NotFoundException } from '@nestjs/common'
import { OutboundService } from './outbound.service'

const PDF_BASE64 = Buffer.from('%PDF-cropped-label').toString('base64')

function buildService() {
  const prisma: any = {
    customer: { findUnique: jest.fn() },
    outboundOrder: { findUnique: jest.fn() },
    outboundAttachment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  }
  const files: any = {
    write: jest.fn().mockReturnValue({
      relativePath: 'outbound-attachments/stored.pdf',
      fullPath: 'unused',
    }),
    read: jest.fn().mockReturnValue(Buffer.from('%PDF-stored')),
  }
  const service = new OutboundService(prisma, {} as any, files)
  return { service, prisma, files }
}

describe('OutboundService cropped label storage', () => {
  it('persists OMS attachment metadata and hides file paths in mapped responses', async () => {
    const { service } = buildService()
    const tx = {
      outboundAttachment: { create: jest.fn().mockResolvedValue({}) },
    }
    const contentHash = 'b'.repeat(64)

    await (service as any).persistAttachments(tx, 9n, [
      {
        fileType: 'sku_label',
        fileName: 'label.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        platformBarcode: '990000001',
        unitIndex: 2,
        sourcePage: 3,
        sourceRow: 1,
        sourceColumn: 0,
        labelRole: 'unit',
        contentHash,
      },
    ])

    expect(tx.outboundAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outboundId: 9n,
        fileType: 'skuLabel',
        sku: 'SKU-A',
        platformBarcode: '990000001',
        unitIndex: 2,
        sourcePage: 3,
        sourceRow: 1,
        sourceColumn: 0,
        labelRole: 'unit',
        contentHash,
      }),
    })

    const [mapped] = (service as any).mapAttachments([
      {
        id: 10n,
        fileType: 'skuLabel',
        fileName: 'label.pdf',
        filePath: 'secret/path.pdf',
        sku: 'SKU-A',
        platformBarcode: '990000001',
        unitIndex: 2,
        sourcePage: 3,
        sourceRow: 1,
        sourceColumn: 0,
        labelRole: 'unit',
        contentHash,
        createdAt: new Date('2026-08-13T00:00:00Z'),
      },
    ])
    expect(mapped).toMatchObject({
      id: 10,
      sku: 'SKU-A',
      unitIndex: 2,
      contentHash,
    })
    expect(mapped).not.toHaveProperty('filePath')
  })

  it('rejects OMS requests before persistence when SKU label counts mismatch', async () => {
    const { service, prisma } = buildService()

    await expect(service.createFromOms({
      customerCode: 'CUST-1',
      items: [{ sku: 'SKU-A', qty: 2 }],
      attachments: [{
        fileType: 'skuLabel',
        fileName: 'label.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        unitIndex: 1,
      }],
    })).rejects.toThrow(BadRequestException)
    await expect(service.createFromOms({
      customerCode: 'CUST-1',
      items: [{ sku: 'SKU-A', qty: 2 }],
      attachments: [{
        fileType: 'skuLabel',
        fileName: 'label.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        unitIndex: 1,
      }],
    })).rejects.toThrow('SKU-A 需要 2 张，收到 1 张')
    expect(prisma.customer.findUnique).not.toHaveBeenCalled()
  })

  it('scopes unit-label lookup to both outbound and SKU', async () => {
    const { service, prisma, files } = buildService()
    prisma.outboundOrder.findUnique.mockResolvedValue({
      id: 7n,
      outboundNo: 'OUT-7',
      items: [{ id: 1n, sku: 'SKU-A' }],
    })
    const records = [
      {
        id: 20n,
        outboundId: 8n,
        fileType: 'skuLabel',
        sku: 'SKU-A',
        unitIndex: 1,
        filePath: 'other-outbound.pdf',
      },
    ]
    prisma.outboundAttachment.findFirst.mockImplementation(({ where }: any) =>
      records.find((record) =>
        record.outboundId === where.outboundId
        && record.fileType === where.fileType
        && record.sku === where.sku
        && record.unitIndex === where.unitIndex,
      ) || null,
    )

    await expect(service.downloadUnitLabel(7, 'SKU-B', 1)).rejects.toThrow(BadRequestException)
    await expect(service.downloadUnitLabel(7, 'SKU-A', 1)).rejects.toThrow(NotFoundException)
    expect(prisma.outboundAttachment.findFirst).toHaveBeenLastCalledWith({
      where: {
        outboundId: 7n,
        fileType: 'skuLabel',
        sku: 'SKU-A',
        unitIndex: 1,
      },
      orderBy: { id: 'asc' },
    })

    records.push({ ...records[0], id: 21n, outboundId: 7n, filePath: 'right-outbound.pdf' })
    const result = await service.downloadUnitLabel(7, 'SKU-A', 1)
    expect(result.fileName).toBe('OUT-7_SKU-A_unit-1.pdf')
    expect(files.read).toHaveBeenCalledWith('right-outbound.pdf')
  })
})

describe('OutboundService.createFromOms transaction', () => {
  const now = new Date('2026-08-18T00:00:00Z')
  const freshOrder = {
    id: 9n,
    outboundNo: 'OUT-OMS-1',
    customerId: 1n,
    warehouseCode: 'WMS-JHB-01',
    status: 'pending_pick',
    trackingNo: null,
    carrier: null,
    logisticsProduct: null,
    platform: null,
    remark: null,
    fbaNo: null,
    fbaWarehouse: null,
    sellerStoreName: null,
    takealotSellerId: null,
    takealotBookingRef: null,
    recipientJson: null,
    shipmentDueDate: null,
    appointmentDate: null,
    shippedAt: null,
    deliveredAt: null,
    podCode: null,
    createdAt: now,
    updatedAt: now,
    items: [{ sku: 'SKU-A', productName: 'Widget', qty: 2, productId: 2n }],
    attachments: [],
  }

  it('locks warehouse stock, holdings, balance and charges in one transaction', async () => {
    const billing = { recordOutboundCharges: jest.fn().mockResolvedValue([]) }
    const prisma: any = {
      customer: { findUnique: jest.fn() },
      outboundOrder: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
      customerSkuInventory: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    }
    const service = new OutboundService(prisma, billing as any, {
      write: jest.fn(),
      read: jest.fn(),
    } as any)

    const tx = {
      customerSkuInventory: {
        findUnique: jest.fn().mockResolvedValue({ id: 11n, quantity: 10 }),
        update: jest.fn().mockResolvedValue({}),
      },
      customer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      outboundOrder: { findUnique: jest.fn().mockResolvedValue(freshOrder) },
    }
    prisma.$transaction.mockImplementation(async (work: any) => work(tx))
    prisma.customer.findUnique.mockResolvedValue({
      id: 1n,
      customerCode: 'CUST-1',
      customerName: 'Acme',
      status: 1,
      balance: 1000,
    })
    prisma.outboundOrder.findUnique.mockResolvedValue(null)
    prisma.product.findUnique.mockResolvedValue({ id: 2n, sku: 'SKU-A', productName: 'Widget' })
    prisma.customerSkuInventory.findUnique.mockResolvedValue({ id: 11n, quantity: 10 })
    const createSpy = jest.spyOn(service, 'create').mockResolvedValue({ id: 9 } as any)

    const result = await service.createFromOms({
      customerCode: 'CUST-1',
      warehouseCode: 'WMS-JHB-01',
      outboundNo: 'OUT-OMS-1',
      stockSource: 'catalog',
      items: [{ sku: 'SKU-A', qty: 2 }],
      preDeduct: {
        preDeductTotal: 12.5,
        lines: [{ type: 'handling', label: '出库操作费', amount: 12.5 }],
      },
    } as any)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outboundNo: 'OUT-OMS-1' }),
      undefined,
      tx,
    )
    expect(tx.customerSkuInventory.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: { quantity: { decrement: 2 } },
    })
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: 1, balance: { gte: 12.5 } },
      data: { balance: { decrement: 12.5 } },
    })
    expect(billing.recordOutboundCharges).toHaveBeenCalledWith(
      expect.objectContaining({ outboundNo: 'OUT-OMS-1', customerId: 1 }),
      tx,
    )
    expect(result.idempotent).toBe(false)
    expect((result as { erpId?: number }).erpId).toBe(9)
  })
})
