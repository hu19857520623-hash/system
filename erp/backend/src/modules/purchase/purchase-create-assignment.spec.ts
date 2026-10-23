import { PurchaseService } from './purchase.service'

function setup() {
  const tx: any = {
    warehouse: { findUnique: jest.fn().mockResolvedValue({ warehouseCode: 'LW-SZ', status: 1, warehouseType: 'logistics' }) },
    productDev: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 21n, applyNo: data.applyNo })),
    },
    prePurchaseOrder: {
      create: jest.fn(async ({ data }) => ({ id: 31n, prePoNo: data.prePoNo, sku: data.sku, status: data.status, domesticFreight: data.domesticFreight })),
    },
  }
  const prisma: any = {
    ...tx,
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 4n }), create: jest.fn() },
    $transaction: jest.fn(async (callback) => callback(tx)),
  }
  const service = new PurchaseService(prisma, { log: jest.fn().mockResolvedValue({}) } as any)
  return { service, tx }
}

describe('创建采购单进入预采购分配', () => {
  it('按明细生成待分配预采购，不创建待审核采购单', async () => {
    const { service, tx } = setup()
    const result = await service.create({
      supplierName: '示例供应商',
      warehouseCode: 'LW-SZ',
      domesticFreight: 80,
      remark: '补货',
      items: [
        { sku: 'FIT-001', productName: '椅子', quantity: 10, unitPrice: 12.5 },
        { sku: 'NEW-002', productName: '新品', quantity: 2, unitPrice: 15 },
      ],
    }, 3)
    expect(result).toMatchObject({ status: 'pending_assign', count: 2 })
    expect(tx.prePurchaseOrder.create).toHaveBeenCalledTimes(2)
    expect(tx.prePurchaseOrder.create.mock.calls[0][0].data).toMatchObject({
      status: 'pending_assign',
      sku: 'FIT-001',
      supplierId: 4n,
      warehouseCode: 'LW-SZ',
      plannedQty: 10,
    })
    expect(tx.prePurchaseOrder.create.mock.calls[0][0].data.convertedPoId).toBeUndefined()
    expect(tx.purchaseOrder).toBeUndefined()
  })

  it('停用仓库不能进入分配', async () => {
    const { service, tx } = setup()
    tx.warehouse.findUnique.mockResolvedValue({ warehouseCode: 'LW-SZ', status: 0, warehouseType: 'logistics' })
    await expect(service.create({
      supplierName: '示例供应商',
      warehouseCode: 'LW-SZ',
      items: [{ sku: 'FIT-001', productName: '椅子', quantity: 1, unitPrice: 10 }],
    })).rejects.toThrow('启用的物流中转仓')
    expect(tx.prePurchaseOrder.create).not.toHaveBeenCalled()
  })
})
