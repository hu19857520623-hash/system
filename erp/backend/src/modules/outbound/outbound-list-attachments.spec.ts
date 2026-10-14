import { OutboundService } from './outbound.service'

describe('outbound list attachment downloads', () => {
  it('returns every original upload including the source SKU label PDF', async () => {
    const attachments = [
      { id: 29, fileType: 'outerLabel', fileName: 'shipping_labels.pdf' },
      { id: 30, fileType: 'skuLabel', fileName: 'product_labels.pdf', labelRole: 'sourceDocument' },
      { id: 31, fileType: 'deliveryList', fileName: 'shipping_note.pdf' },
      { id: 32, fileType: 'appointment', fileName: 'appointment.pdf' },
    ]
    const service = Object.create(OutboundService.prototype) as OutboundService
    Object.assign(service, {
      prisma: { outboundOrder: {
        findMany: jest.fn().mockImplementation(async () => [{
          id: 54, status: 'picking', attachments,
        }]),
        count: jest.fn().mockResolvedValue(1),
      } },
      buildListWhere: jest.fn().mockReturnValue({}),
      enrichOrders: jest.fn().mockImplementation(async rows => rows),
    })
    const result = await service.list({ page: 1, pageSize: 10 })
    expect(result.items[0].attachments.map((a: any) => a.fileType)).toEqual(['outerLabel', 'skuLabel', 'deliveryList', 'appointment'])
    expect((service as any).prisma.outboundOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ attachments: expect.objectContaining({ where: { OR: [
        { fileType: { not: 'skuLabel' } }, { labelRole: 'sourceDocument' }, { labelRole: null, sku: null, unitIndex: null },
      ] } }) }),
    }))
    expect(result.items[0].attachments[0].id).toBe(29)
  })
})
