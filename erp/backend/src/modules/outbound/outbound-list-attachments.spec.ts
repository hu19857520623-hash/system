import { OutboundService } from './outbound.service'

describe('outbound list attachment downloads', () => {
  it('returns outer labels together with delivery and appointment documents', async () => {
    const attachments = [
      { id: 29, fileType: 'outerLabel', fileName: 'shipping_labels.pdf' },
      { id: 30, fileType: 'skuLabel', fileName: 'unit_labels.pdf' },
      { id: 31, fileType: 'deliveryList', fileName: 'shipping_note.pdf' },
      { id: 32, fileType: 'appointment', fileName: 'appointment.pdf' },
    ]
    const service = Object.create(OutboundService.prototype) as OutboundService
    Object.assign(service, {
      prisma: { outboundOrder: {
        findMany: jest.fn().mockImplementation(async query => [{
          id: 54, status: 'picking', attachments: attachments.filter(a =>
            !query.include.attachments.where.fileType.notIn.includes(a.fileType)),
        }]),
        count: jest.fn().mockResolvedValue(1),
      } },
      buildListWhere: jest.fn().mockReturnValue({}),
      enrichOrders: jest.fn().mockImplementation(async rows => rows),
    })
    const result = await service.list({ page: 1, pageSize: 10 })
    expect(result.items[0].attachments.map((a: any) => a.fileType)).toEqual(['outerLabel', 'deliveryList', 'appointment'])
    expect(result.items[0].attachments[0].id).toBe(29)
  })
})
