import { PurchaseService } from './purchase.service'

const header = '供应商,目标中转仓,预计到货,国内运费,备注,SKU,商品名称,采购数量,单价,行备注'

function setup() {
  const prisma: any = {
    warehouse: {
      findMany: jest.fn().mockResolvedValue([
        { warehouseCode: 'LW-SZ', warehouseName: '深圳集运物流仓' },
        { warehouseCode: 'LW-YW', warehouseName: '义乌集运物流仓' },
      ]),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        { id: 7n, sku: 'FIT-001', productName: '档案扶手椅' },
      ]),
    },
  }
  const service = new PurchaseService(prisma, { log: jest.fn() } as any)
  const create = jest.spyOn(service, 'create').mockImplementation(async (data: any) => ({ poNo: data.poNo, items: data.items }) as any)
  return { service, create, prisma }
}

describe('采购单批量导入', () => {
  it('合并同单明细，并按仓库代码和商品档案补齐后创建', async () => {
    const { service, create } = setup()
    const csv = [
      header,
      '示例供应商,深圳集运物流仓,2026-11-01,80,补货,fit-001,,10,120.50,',
      '示例供应商,深圳集运物流仓,2026-11-01,80,补货,NEW-002,新品,2,15,加急',
      '另一供应商,LW-YW,,,,TK-009,桌子,1,70,',
    ].join('\n')

    const result = await service.importFromCsv(csv, 3)

    expect(result).toMatchObject({ imported: 3, failed: 0 })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0]).toMatchObject({
      supplierName: '示例供应商',
      warehouseCode: 'LW-SZ',
      expectedArrival: '2026-11-01',
      domesticFreight: 80,
      remark: '补货',
      items: [
        { productId: 7, sku: 'FIT-001', productName: '档案扶手椅', quantity: 10, unitPrice: 120.5 },
        { productId: 0, sku: 'NEW-002', productName: '新品', quantity: 2, unitPrice: 15, remark: '加急' },
      ],
    })
    expect(create.mock.calls[0][1]).toBe(3)
    expect(String(create.mock.calls[0][0].poNo).length).toBeLessThanOrEqual(30)
    expect(create.mock.calls[1][0]).toMatchObject({ supplierName: '另一供应商', warehouseCode: 'LW-YW' })
  })

  it('未知仓库和无效行不创建采购单，其余行仍写入', async () => {
    const { service, create } = setup()
    const csv = [
      header,
      '示例供应商,不存在的仓,,,,FIT-001,,1,10,',
      '示例供应商,, ,,,FIT-001,,1,10,',
      '示例供应商,义乌集运物流仓,,,,FIT-001,,4,10,',
    ].join('\n')

    const result = await service.importFromCsv(csv, 1)

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].items).toEqual([
      expect.objectContaining({ sku: 'FIT-001', quantity: 4 }),
    ])
    expect(result.imported).toBe(1)
    expect(result.failed).toBe(2)
    expect(result.failures.map((failure) => failure.reason).join('\n')).toContain('不是已启用的物流中转仓')
    expect(result.failures.map((failure) => failure.reason).join('\n')).toContain('目标中转仓不能为空')
  })

  it('空文件不写入', async () => {
    const { service, create } = setup()
    await expect(service.importFromCsv(`${header}\n`)).rejects.toThrow('文件为空或没有有效数据行')
    expect(create).not.toHaveBeenCalled()
  })

  it('创建失败时整组记为失败，不影响其他采购单', async () => {
    const { service, create } = setup()
    create.mockImplementation(async (data: any) => {
      if (data.supplierName === '失败供应商') throw new Error('供应商写入失败')
      return { poNo: data.poNo } as any
    })
    const csv = [
      header,
      '失败供应商,深圳集运物流仓,,,,FIT-001,,1,10,',
      '失败供应商,深圳集运物流仓,,,,NEW-002,新品,2,8,',
      '正常供应商,义乌集运物流仓,,,,TK-009,桌子,1,70,',
    ].join('\n')

    const result = await service.importFromCsv(csv)

    expect(result.imported).toBe(1)
    expect(result.failed).toBe(2)
    expect(result.failures.every((failure) => failure.reason === '供应商写入失败')).toBe(true)
  })
})
