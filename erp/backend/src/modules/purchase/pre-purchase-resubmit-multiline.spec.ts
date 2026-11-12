import { PrePurchaseService } from './pre-purchase.service'

function setup() {
  const po: any = {
    id: 9n, poNo: 'PO-DIRECT-MULTI', status: 'rejected', prePoId: null, purchaserId: 1n, supplierId: 2n,
    warehouseCode: 'LW-TEST', domesticFreight: null, expectedArrival: null, remark: null, totalAmount: 0,
    items: [
      { id: 11n, sku: 'SKU-A', productName: '商品A', plannedQty: 5, quantity: 0, amount: 0, unitPrice: 10, remark: null, receivedQty: 0 },
      { id: 12n, sku: 'SKU-B', productName: '商品B', plannedQty: 3, quantity: 0, amount: 0, unitPrice: 20, remark: null, receivedQty: 0 },
    ],
  }
  const tx: any = {
    sysUser: { findUnique: jest.fn().mockResolvedValue({ roleCode: 'purchaser', status: 1, realName: '采购员' }) },
    operationLog: { create: jest.fn().mockResolvedValue({ id: 1n }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: {
      findUnique: jest.fn(async ({ include }: any) => include?.items ? { ...po, items: po.items.map((line: any) => ({ ...line })) } : { ...po, items: po.items.map((line: any) => ({ ...line })) }),
      update: jest.fn(async ({ data }: any) => {
        if (data.items?.update) {
          const entries = Array.isArray(data.items.update) ? data.items.update : [data.items.update]
          for (const entry of entries) Object.assign(po.items.find((line: any) => line.id === entry.where.id), entry.data)
        }
        const { items: _items, ...patch } = data
        Object.assign(po, patch)
        return { ...po, items: po.items.map((line: any) => ({ ...line })) }
      }),
    },
    prePurchaseOrder: {
      findUnique: jest.fn(async () => ({ id: 8n, status: 'confirmed', convertedPoId: 9n, purchaserId: 1n })),
    },
    purchaseOrderItem: {
      update: jest.fn(async ({ where, data }: any) => Object.assign(po.items.find((line: any) => line.id === where.id), data)),
      create: jest.fn(async ({ data }: any) => { const line = { id: 13n, receivedQty: 0, ...data }; po.items.push(line); return line }),
      delete: jest.fn(async ({ where }: any) => { po.items = po.items.filter((line: any) => line.id !== where.id) }),
    },
    supplier: {
      findUnique: jest.fn().mockResolvedValue({ id: 2n, status: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 2n, status: 1 }),
      create: jest.fn().mockResolvedValue({ id: 3n }),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ warehouseCode: 'LW-TEST', warehouseType: 'logistics', status: 1 }) },
  }
  const prisma = { ...tx, $transaction: jest.fn(async (callback: any) => callback(tx)) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new PrePurchaseService(prisma as any, log as any)
  jest.spyOn(service as any, 'enrich').mockImplementation(async (rows: any[]) => rows)
  return { po, tx, service, log }
}

const header = { supplierName: '示例供应商', warehouseCode: 'LW-TEST', remark: '重提备注' }

describe('历史直采驳回单多明细修改重提', () => {
  it('逐条修改后回到待核定，数量金额清零并保留原采购单号', async () => {
    const { po, tx, service, log } = setup()
    const result = await service.resubmitRejected(9, {
      ...header,
      items: [
        { id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 4, unitPrice: 11 },
        { id: 12, sku: 'SKU-B', productName: '商品B', plannedQty: 3, unitPrice: 20, remark: '按样' },
      ],
    }, { userId: 1, roleCode: 'purchaser' })
    expect(result.status).toBe('pending_actual_qty')
    expect(po.status).toBe('pending_actual_qty')
    expect(po.totalAmount).toBe(0)
    expect(po.remark).toBe('重提备注')
    expect(po.items).toHaveLength(2)
    expect(po.items[0]).toMatchObject({ sku: 'SKU-A', plannedQty: 4, quantity: 0, amount: 0, unitPrice: 11 })
    expect(po.items[1]).toMatchObject({ sku: 'SKU-B', plannedQty: 3, quantity: 0, amount: 0, remark: '按样' })
    expect(po.prePoId).toBeNull()
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        module: 'purchase', action: 'resubmit_direct_po', targetId: 'PO-DIRECT-MULTI',
        detail: expect.objectContaining({ lines: [{ sku: 'SKU-A', plannedQty: 4 }, { sku: 'SKU-B', plannedQty: 3 }] }),
      }),
    }))
    expect(log.log).not.toHaveBeenCalled()
  })

  it('新增与删除明细一并处理，已收货明细不能删除', async () => {
    const { po, tx, service } = setup()
    await service.resubmitRejected(9, {
      ...header,
      items: [
        { id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 2, unitPrice: 10 },
        { sku: 'SKU-C', productName: '商品C', plannedQty: 1, unitPrice: 5 },
      ],
    }, { userId: 1, roleCode: 'purchaser' })
    expect(tx.purchaseOrderItem.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12n } }))
    expect(tx.purchaseOrderItem.create).toHaveBeenCalledTimes(1)
    expect(po.items.map((line: any) => line.sku)).toEqual(['SKU-A', 'SKU-C'])

    po.status = 'rejected'
    po.items[0].receivedQty = 1
    await expect(service.resubmitRejected(9, {
      ...header,
      items: [{ id: 12, sku: 'SKU-B', productName: '商品B', plannedQty: 1, unitPrice: 20 }],
    }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('已有收货数量，不能删除')
  })

  it.each([
    [{ items: [] }, '请逐条填写采购明细'],
    [{ items: [{ id: 11, sku: ' ', productName: '商品A', plannedQty: 1, unitPrice: 1 }] }, 'SKU 不能为空'],
    [{ items: [{ id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 0, unitPrice: 1 }] }, '采购数量须为大于零的整数'],
    [{ items: [{ id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 1, unitPrice: 0 }] }, '采购单价'],
    [{ items: [{ id: 11, sku: 'SKU-A', productName: '', plannedQty: 1, unitPrice: 1 }] }, '商品名称'],
  ] as const)('无效明细中文拒绝且零写入 %#', async (data, message) => {
    const { tx, service } = setup()
    await expect(service.resubmitRejected(9, { ...header, ...data } as any, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow(message)
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
    expect(tx.purchaseOrderItem.update).not.toHaveBeenCalled()
    expect(tx.purchaseOrderItem.create).not.toHaveBeenCalled()
    expect(tx.purchaseOrderItem.delete).not.toHaveBeenCalled()
  })

  it('明细已变化或单据状态变化时拒绝并提示刷新', async () => {
    const { po, service } = setup()
    await expect(service.resubmitRejected(9, {
      ...header,
      items: [{ id: 99, sku: 'SKU-X', productName: '商品X', plannedQty: 1, unitPrice: 1 }],
    }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('采购明细已变化')
    po.prePoId = 8n
    await expect(service.resubmitRejected(9, {
      ...header,
      items: [{ id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 1, unitPrice: 1 }],
    }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('状态已变化')
    po.prePoId = null
    po.status = 'pending_actual_qty'
    await expect(service.resubmitRejected(9, {
      ...header,
      items: [{ id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 1, unitPrice: 1 }],
    }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('仅已驳回的采购单')
  })

  it('日志写入失败拒绝整个重提事务', async () => {
    const { tx, service, log } = setup()
    tx.operationLog.create.mockRejectedValueOnce(new Error('重提日志失败'))
    await expect(service.resubmitRejected(9, {
      ...header,
      items: [
        { id: 11, sku: 'SKU-A', productName: '商品A', plannedQty: 4, unitPrice: 11 },
        { id: 12, sku: 'SKU-B', productName: '商品B', plannedQty: 3, unitPrice: 20 },
      ],
    }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('重提日志失败')
    expect(log.log).not.toHaveBeenCalled()
    expect(tx.operationLog.create).toHaveBeenCalledTimes(1)
  })

  it('单明细直采驳回仍走原预采购分配路径', async () => {
    const { po, tx, service } = setup()
    po.items = [po.items[0]]
    tx.prePurchaseOrder = {
      create: jest.fn(async ({ data }: any) => ({ id: 31n, ...data })),
    }
    tx.productDev = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }: any) => ({ id: 21n, applyNo: data.applyNo })) }
    const result = await service.resubmitRejected(9, {
      ...header, sku: 'SKU-A', productName: '商品A', plannedQty: 4, unitPrice: 11,
    }, { userId: 1, roleCode: 'purchaser' })
    expect(tx.prePurchaseOrder.create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ id: 31n, status: 'pending_assign', convertedPoId: 9n })
    expect(po.items[0]).toMatchObject({ sku: 'SKU-A', quantity: 4, plannedQty: 4 })
  })
})
