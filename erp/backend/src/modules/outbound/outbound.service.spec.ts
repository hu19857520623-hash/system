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
