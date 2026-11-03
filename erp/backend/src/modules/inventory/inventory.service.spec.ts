import { BadRequestException, NotFoundException } from '@nestjs/common'
import { InventoryService } from './inventory.service'

describe('InventoryService.transferLogistics', () => {
  const sz = { warehouseCode: 'LW-SZ-01', warehouseName: '深圳集运物流仓', warehouseType: 'logistics', status: 1 }
  const yw = { warehouseCode: 'LW-YW-01', warehouseName: '义乌集运物流仓', warehouseType: 'logistics', status: 1 }
  const product = { id: 9n, sku: 'TKL-HX6' }

  function createService() {
    const tx: any = {
      $queryRaw:jest.fn(),warehouse:{findUnique:jest.fn()},product:{findFirst:jest.fn()},
      sysUser:{findUnique:jest.fn().mockResolvedValue({realName:'库存验收员'})},operationLog:{create:jest.fn()},
      inventory: { findUnique: jest.fn() },
    }
    const prisma = {
      warehouse: tx.warehouse,
      product: tx.product,
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }
    const opLog = { log: jest.fn().mockResolvedValue(undefined) }
    const inventoryMutation = { applyWarehouseQtyDelta: jest.fn().mockResolvedValue(undefined) }
    const service = new InventoryService(prisma as any, opLog as any, inventoryMutation as any)
    return { service, prisma, tx, opLog, inventoryMutation }
  }

  it('moves available qty from Shenzhen to Yiwu and writes paired logs', async () => {
    const { service, prisma, tx, opLog, inventoryMutation } = createService()
    prisma.warehouse.findUnique.mockResolvedValueOnce(sz).mockResolvedValueOnce(yw)
    prisma.product.findFirst.mockResolvedValue(product)
    tx.inventory.findUnique.mockResolvedValue({ availableQty: 80, totalQty: 100, lockedQty: 20 })

    const result = await service.transferLogistics({
      sku: 'TKL-HX6',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 40,
      remark: '集货',
    }, 1)

    expect(result.qty).toBe(40)
    expect(result.fromWarehouseCode).toBe('LW-SZ-01')
    expect(result.toWarehouseCode).toBe('LW-YW-01')
    expect(result.referenceNo).toMatch(/^LT-/)
    expect(inventoryMutation.applyWarehouseQtyDelta).toHaveBeenNthCalledWith(1, tx, expect.objectContaining({
      warehouseCode: 'LW-SZ-01',
      diff: -40,
      changeType: 'logistics_transfer',
      remark: '调拨至 义乌集运物流仓 · 集货',
    }))
    expect(inventoryMutation.applyWarehouseQtyDelta).toHaveBeenNthCalledWith(2, tx, expect.objectContaining({
      warehouseCode: 'LW-YW-01',
      diff: 40,
      changeType: 'logistics_transfer',
      remark: '从 深圳集运物流仓 调入 · 集货',
    }))
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({
      action: 'logistics_transfer',
      targetId: 'TKL-HX6',
    })}))
    expect(opLog.log).not.toHaveBeenCalled()
  })

  it('rejects when available qty is insufficient', async () => {
    const { service, prisma, tx } = createService()
    prisma.warehouse.findUnique.mockResolvedValueOnce(sz).mockResolvedValueOnce(yw)
    prisma.product.findFirst.mockResolvedValue(product)
    tx.inventory.findUnique.mockResolvedValue({ availableQty: 10, totalQty: 30, lockedQty: 20 })

    await expect(service.transferLogistics({
      sku: 'TKL-HX6',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 40,
    }, 1)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects unknown SKU', async () => {
    const { service, prisma } = createService()
    prisma.warehouse.findUnique.mockResolvedValueOnce(sz).mockResolvedValueOnce(yw)
    prisma.product.findFirst.mockResolvedValue(null)

    await expect(service.transferLogistics({
      sku: 'NOPE',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 1,
    }, 1)).rejects.toBeInstanceOf(NotFoundException)
  })
  it('审计失败使包含调出调入的事务拒绝，不调用独立日志连接',async()=>{
    const {service,prisma,tx,opLog,inventoryMutation}=createService();prisma.warehouse.findUnique.mockResolvedValueOnce(sz).mockResolvedValueOnce(yw);prisma.product.findFirst.mockResolvedValue(product);tx.inventory.findUnique.mockResolvedValue({availableQty:10});tx.operationLog.create.mockRejectedValueOnce(new Error('库存日志失败'))
    await expect(service.transferLogistics({sku:'TKL-HX6',fromWarehouseCode:'LW-SZ-01',toWarehouseCode:'LW-YW-01',qty:2},1)).rejects.toThrow('库存日志失败')
    expect(inventoryMutation.applyWarehouseQtyDelta).toHaveBeenCalledTimes(2);expect(opLog.log).not.toHaveBeenCalled()
  })
  it('returns original receipt without repeating stock mutation and rejects changed content', async () => {
    const { service, prisma, tx, inventoryMutation } = createService()
    prisma.warehouse.findUnique.mockImplementation(async ({ where }) => where.warehouseCode === sz.warehouseCode ? sz : yw)
    prisma.product.findFirst.mockResolvedValue(product)
    tx.inventory.findUnique.mockResolvedValue({ availableQty: 80 })
    let receipt: any = null
    tx.operationLog = { findFirst: jest.fn(async () => receipt) }
    tx.operationLog.create = jest.fn(async ({ data }: any) => { receipt = { detail: data.detail }; return {} })
    const request = { sku: 'TKL-HX6', fromWarehouseCode: sz.warehouseCode, toWarehouseCode: yw.warehouseCode, qty: 3, clientRequestId: '7d3ec662-cd20-4b8c-b459-eb2d74851e76' }
    const original = await service.transferLogistics(request, 7)
    tx.inventory.findUnique.mockResolvedValue({ availableQty: 0 })
    expect(await service.transferLogistics(request, 7)).toEqual({ ...original, duplicate: true })
    expect(inventoryMutation.applyWarehouseQtyDelta).toHaveBeenCalledTimes(2)
    await expect(service.transferLogistics({ ...request, qty: 4 }, 7)).rejects.toThrow('原调拨请求内容不同')
    expect(inventoryMutation.applyWarehouseQtyDelta).toHaveBeenCalledTimes(2)
    expect(tx.operationLog.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ operatorId: 7n }) }))
  })

})
