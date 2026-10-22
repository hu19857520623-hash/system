import { randomUUID } from 'crypto'
import { InboundService } from './inbound.service'
import * as putaway from './inbound-putaway-transaction.util'
import { inboundMeasurementVersion } from './inbound-receiving-version.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'

function fixture() {
  let state: any = {
    order: { id: 1n, inboundNo: 'RV-TEST', warehouseCode: 'WMS-JHB-01', status: 'pending_putaway', omsCustomerCode: null, cartons: [], items: [1, 2].map(id => ({ id: BigInt(id), productId: BigInt(id + 10), sku: `SKU-${id}`, expectedQty: 2, actualQty: 2, putawayQty: 0, qcStatus: 'pass', costRmb: 10, seaFreightPerUnit: 2, domesticFeePerUnit: 1 })) },
    products: [1, 2].map(id => ({ id: BigInt(id + 10), sku: `SKU-${id}`, measuredLengthCm: 10, measuredWidthCm: 20, measuredHeightCm: 30 })),
    locations: ['A-01', 'A-02'].map((locationCode, index) => ({ id: BigInt(index + 1), zoneId: 1n, locationCode, warehouseCode: 'WMS-JHB-01', status: 'available', zone: { status: 1, warehouseCode: 'WMS-JHB-01' } })),
    stock: [], lots: [], putaways: [], inventoryLogs: [], operations: [],
  }
  let queue = Promise.resolve(), fail = false
  const prisma: any = { $transaction: (callback: any) => {
    const result = queue.then(async () => {
      const draft = structuredClone(state)
      const byInventory = (where: any) => draft.stock.find((row: any) => where.id ? row.id === where.id : row.productId === where.productId_warehouseCode.productId && row.warehouseCode === where.productId_warehouseCode.warehouseCode)
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        inboundOrder: { findUnique: async () => draft.order, update: async ({ data }: any) => Object.assign(draft.order, data) },
        warehouse: { findUnique: async () => ({ status: 1, warehouseType: 'wms' }) },
        product: { findMany: async () => draft.products },
        warehouseLocation: { findMany: async ({ where }: any) => draft.locations.filter((row: any) => where.locationCode.in.includes(row.locationCode)) },
        inboundOrderItem: { update: async ({ where, data }: any) => Object.assign(draft.order.items.find((row: any) => row.id === where.id), data) },
        inboundPutawayItem: { create: async ({ data }: any) => { draft.putaways.push(data); return data } },
        inventory: {
          findUnique: async ({ where }: any) => byInventory(where),
          update: async ({ where, data }: any) => Object.assign(byInventory(where), data),
          updateMany: async ({ where, data }: any) => { for (const row of draft.stock) if (row.productId === where.productId && row.warehouseCode === where.warehouseCode) Object.assign(row, data); return { count: 1 } },
          create: async ({ data }: any) => { const row = { id: BigInt(draft.stock.length + 1), lockedQty: 0, ...data }; draft.stock.push(row); return row },
        },
        inventoryLocation: {
          findFirst: async ({ where }: any) => draft.lots.find((row: any) => row.productId === where.productId && row.locationId === where.locationId && row.batchNo === where.batchNo),
          findMany: async ({ where }: any) => draft.lots.filter((row: any) => row.productId === where.productId && row.warehouseCode === where.warehouseCode && row.qty > 0),
          create: async ({ data }: any) => { const row = { id: BigInt(draft.lots.length + 1), ...data }; draft.lots.push(row); return row },
          update: async ({ where, data }: any) => Object.assign(draft.lots.find((row: any) => row.id === where.id), data),
        },
        inventoryLog: { create: async ({ data }: any) => { draft.inventoryLogs.push(data); return data } },
        productPricing: { findFirst: async () => null },
        operationLog: { findFirst: async ({ where }: any) => draft.operations.find((row: any) => row.operatorId === where.operatorId && row.detail.clientRequestId === where.detail.equals),
          create: async ({ data }: any) => { if (fail) throw new Error('末尾日志失败'); draft.operations.push(data); return data } },
      }
      const result = await callback(tx); state = draft; return result
    })
    queue = result.then(() => undefined, () => undefined); return result
  } }
  const payload = (groups = [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 1 }] }]) => ({ clientRequestId: randomUUID(), expectedVersion: inboundMeasurementVersion(state.order, state.products), items: groups })
  return { prisma, state: () => state, payload, fail: (value: boolean) => { fail = value }, inventory: new InventoryMutationService() }
}

describe('实际库位上架与库存原子提交', () => {
  it.each([0, -1, 1.5, true, [], null, 2147483648])('无效数量%p不写入库存', async quantity => {
    const f = fixture(), before = structuredClone(f.state())
    await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, f.payload([{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: quantity as any }] }]), 1)).rejects.toThrow('整数')
    expect(f.state()).toEqual(before)
  })
  it('部分上架保留剩余量，仓级、库位、批次成本与流水一致', async () => {
    const f = fixture()
    expect(await putaway.runInboundPutaway(f.prisma, f.inventory, 1, f.payload(), 1)).toMatchObject({ allDone: false, processedQty: 1, remainingQty: 3, status: 'pending_putaway' })
    expect(f.state().stock[0]).toMatchObject({ totalQty: 1, availableQty: 1, lockedQty: 0, avgCostRmb: 13 })
    expect(f.state().lots[0]).toMatchObject({ qty: 1, batchNo: 'RV-TEST', unitCostRmb: 13 })
    expect(f.state().inventoryLogs[0]).toMatchObject({ beforeQty: 0, afterQty: 1, changeQty: 1 })
  })
  it('最后一次上架后完结；原请求在完结后重放不再加库存', async () => {
    const f = fixture(), input = f.payload([{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 2 }] }, { inboundItemId: 2, lines: [{ locationCode: 'A-02', qty: 2 }] }])
    expect(await putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1)).toMatchObject({ allDone: true, remainingQty: 0, status: 'completed' })
    const before = structuredClone(f.state())
    expect(await putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1)).toMatchObject({ duplicate: true })
    expect(f.state()).toEqual(before)
  })
  it('同一请求并发调用只加一次库存，改变原请求被拒绝', async () => {
    const f = fixture(), input = f.payload()
    const results = await Promise.all([putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1), putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1)])
    expect(results.map(row => row.duplicate).sort()).toEqual([false, true]); expect(f.state().stock[0].totalQty).toBe(1)
    await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, { ...input, items: [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 2 }] }] }, 1)).rejects.toThrow('内容不同')
  })
  it('两个不同操作基于同一旧页面提交，后到请求拒绝，不覆盖已上架值', async () => {
    const f = fixture(), first = f.payload(), second = f.payload()
    await putaway.runInboundPutaway(f.prisma, f.inventory, 1, first, 1)
    await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, second, 2)).rejects.toThrow('已变更')
    expect(f.state().stock[0].totalQty).toBe(1)
  })
  it('末尾操作凭据失败时回滚库位、仓级、单据与所有流水，原标识可重试', async () => {
    const f = fixture(), input = f.payload(), before = structuredClone(f.state())
    f.fail(true)
    await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1)).rejects.toThrow('末尾日志失败')
    expect(f.state()).toEqual(before)
    f.fail(false); await putaway.runInboundPutaway(f.prisma, f.inventory, 1, input, 1)
    expect(f.state().stock[0].totalQty).toBe(1); expect(f.state().operations).toHaveLength(1)
  })
  it('仅有申报尺寸、未实收、库区停用、跨仓库位均不能上架', async () => {
    for (const mutate of [
      (state: any) => { state.products[0].measuredLengthCm = null; state.products[0].lengthCm = 10 },
      (state: any) => { state.order.items[1].actualQty = null },
      (state: any) => { state.locations[0].zone.status = 0 },
      (state: any) => { state.locations[0].zone.warehouseCode = 'OTHER' },
    ]) {
      const f = fixture(); mutate(f.state()); const before = structuredClone(f.state())
      await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, f.payload(), 1)).rejects.toThrow()
      expect(f.state()).toEqual(before)
    }
  })
  it('重复明细、重复库位及超出实收余量在提交前阻止', async () => {
    const f = fixture()
    for (const items of [
      [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 1 }] }, { inboundItemId: 1, lines: [{ locationCode: 'A-02', qty: 1 }] }],
      [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 1 }, { locationCode: 'a-01', qty: 1 }] }],
      [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 3 }] }],
    ]) await expect(putaway.runInboundPutaway(f.prisma, f.inventory, 1, f.payload(items), 1)).rejects.toThrow()
    expect(f.state().stock).toHaveLength(0)
  })
})

describe('上架提交成功后的继续与恢复反馈', () => {
  afterEach(() => jest.restoreAllMocks())
  it('OMS或费用同步失败返回已保存并待同步，重试仍调用原请求', async () => {
    const core = jest.spyOn(putaway, 'runInboundPutaway').mockResolvedValue({ id: 1, inboundNo: 'RV-A', allDone: false, items: [] } as any)
    const service = new InboundService({ inboundOrder: { findUnique: jest.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce({ omsCustomerCode: null }) } } as any, null as any, null as any, null as any, null as any, null as any)
    const payload: any = { clientRequestId: randomUUID() }
    expect(await service.putaway(1, payload, 1)).toMatchObject({ syncPending: true, warning: expect.stringContaining('库存已保存') })
    expect(await service.putaway(1, payload, 1)).not.toHaveProperty('syncPending')
    expect(core.mock.calls[0]).toEqual(core.mock.calls[1])
  })
  it('旧的一键确认不能默认接受差异和自动写入待上架区', async () => {
    const service = new InboundService({} as any, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ status: 'pending_putaway' } as any)
    await expect(service.confirm(1, {}, 1)).rejects.toThrow('实际库位')
  })
})
