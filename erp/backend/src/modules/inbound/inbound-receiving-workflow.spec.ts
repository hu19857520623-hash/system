import { randomUUID } from 'crypto'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { inboundCartonReadiness } from './inbound-carton-readiness.util'
import { inboundMeasurementVersion, inboundReceivingVersion } from './inbound-receiving-version.util'
import { runInboundReceiving, normalizeReceivingInput } from './inbound-receiving-transaction.util'
import { parseInboundQcScanInput } from './inbound-qc-scan.util'
import { RecordInboundCartonsDto, SubmitInboundQcDto } from './dto/inbound-receiving.dto'
import { InboundService } from './inbound.service'

function fixture(cartonCount = 1) {
  let state: any = {
    order: { id: 1n, inboundNo: 'RV-AUDIT', warehouseCode: 'WMS-JHB-01', status: 'arrived', receivedCartonCount: null,
      items: [1, 2].map(id => ({ id: BigInt(id), productId: BigInt(id + 10), sku: `TKL9001-A${id}`, expectedQty: 2, actualQty: null, putawayQty: 0, qcStatus: 'pending' })),
      cartons: Array.from({ length: cartonCount }, (_, index) => ({ id: BigInt(index + 1), boxCode: `BOX-${index + 1}`, boxSeq: index + 1, status: 'pending', items: [] })) },
    products: [1, 2].map(id => ({ id: BigInt(id + 10), sku: `TKL9001-A${id}`, customerSku: `A${id}`, barcode: `BAR-${id}`, lengthCm: 1, widthCm: 1, heightCm: 1 })), logs: [],
  }
  let failProduct = false, queue = Promise.resolve()
  const prisma: any = { $transaction: (callback: any) => {
    const execute = async () => {
      const draft = structuredClone(state)
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]), $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        warehouse: { findUnique: async () => ({ status: 1, warehouseType: 'wms' }) },
        inboundOrder: { findUnique: async () => draft.order, update: async ({ data }: any) => Object.assign(draft.order, data) },
        inboundOrderItem: { update: async ({ where, data }: any) => Object.assign(draft.order.items.find((row: any) => row.id === where.id), data) },
        inboundCarton: { update: async ({ where, data }: any) => Object.assign(draft.order.cartons.find((row: any) => row.id === where.id), data) },
        product: { findMany: async () => draft.products, update: async ({ where, data }: any) => { if (failProduct) throw new Error('数据库写入失败'); return Object.assign(draft.products.find((row: any) => row.id === where.id), data) } },
        operationLog: {
          findFirst: async ({ where }: any) => [...draft.logs].reverse().find((row: any) => row.module === where.module && (!where.action || (typeof where.action === 'string' ? row.action === where.action : where.action.in.includes(row.action))) && (!where.operatorId || row.operatorId === where.operatorId) && (!where.targetId || row.targetId === where.targetId) && (!where.detail || row.detail?.clientRequestId === where.detail.equals)) || null,
          create: async ({ data }: any) => { draft.logs.push(structuredClone(data)); return data },
        },
      }
      const result = await callback(tx); state = draft; return result
    }
    const result = queue.then(execute); queue = result.then(() => undefined, () => undefined); return result
  } }
  const count = (n = cartonCount, reason = '') => ({ clientRequestId: randomUUID(), receivedCartonCount: n, differenceReason: reason })
  const qc = (measured = false) => ({ clientRequestId: randomUUID(), expectedVersion: measured ? inboundMeasurementVersion(state.order, state.products) : inboundReceivingVersion(state.order), items: state.order.items.map((row: any) => ({ id: Number(row.id), sku: row.sku, actualQty: 2, qcStatus: 'pass', ...(measured ? { lengthCm: 10, widthCm: 20, heightCm: 30 } : {}) })) })
  return { prisma, count, qc, state: () => state, failProduct: () => { failProduct = true } }
}

describe('仓库收箱、清点和测量的一致性', () => {
  const identityKinds = ['carton-count', 'carton-scan', 'qc-scan'] as const
  async function identityFixture(kind: typeof identityKinds[number]) {
    const f = fixture()
    if (kind === 'qc-scan') await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    f.prisma.inboundOrder = { findUnique: jest.fn(async ({ where }: any) => {
      if (where.inboundNo !== 'RV-AUDIT') throw new Error('同步必须使用原入库单号')
      return f.state().order
    }) }
    const service = new InboundService(f.prisma, null as any, null as any, null as any, null as any, null as any)
    const input = kind === 'carton-count' ? f.count() : { clientRequestId: randomUUID(), scanCode: kind === 'carton-scan' ? 'BOX-1' : 'BAR-1' }
    const submit = () => kind === 'carton-count' ? service.recordReceivedCartonCount(1, input as any, 1)
      : kind === 'carton-scan' ? service.receiveBox(1, input as any, 1) : service.scanQc(1, input as any, 1)
    return { f, input, submit }
  }
  it.each(identityKinds)('%s 的新回执携带身份，真实服务后处理不能误报同步失败', async kind => {
    const { f, input, submit } = await identityFixture(kind)
    expect(await submit()).toMatchObject({ id: 1, inboundNo: 'RV-AUDIT', syncPending: false, duplicate: false })
    const receipt = f.state().logs.find((row: any) => row.detail?.clientRequestId === input.clientRequestId)
    expect(receipt.detail.response).toMatchObject({ id: 1, inboundNo: 'RV-AUDIT' })
  })
  it.each(identityKinds)('%s 的历史缺身份回执可补齐返回，已完结后重试不重做业务或改写历史', async kind => {
    const { f, input, submit } = await identityFixture(kind)
    await submit()
    const receipt = f.state().logs.find((row: any) => row.detail?.clientRequestId === input.clientRequestId)
    delete receipt.detail.response.id; delete receipt.detail.response.inboundNo
    f.state().order.status = 'completed'
    const before = structuredClone(f.state())
    expect(await submit()).toMatchObject({ id: 1, inboundNo: 'RV-AUDIT', syncPending: false, duplicate: true, increment: 0 })
    expect(f.state()).toEqual(before)
  })
  it.each([0, -1, 1.2, true, [], null, 2147483648])('拒绝无效箱数 %p，不能改变到仓状态', async value => {
    const f = fixture()
    await expect(runInboundReceiving(f.prisma, 1, 'carton-count', { ...f.count(), receivedCartonCount: value } as any, 1)).rejects.toThrow('整数')
    expect(f.state().order.status).toBe('arrived'); expect(f.state().logs).toHaveLength(0)
  })
  it('箱数差异缺原因、外箱不匹配均不能提前开始收货', async () => {
    const f = fixture(2)
    await expect(runInboundReceiving(f.prisma, 1, 'carton-count', f.count(1), 1)).rejects.toThrow('差异原因')
    await expect(runInboundReceiving(f.prisma, 1, 'carton-scan', { clientRequestId: randomUUID(), scanCode: 'WRONG' }, 1)).rejects.toThrow('未匹配')
    expect(f.state().order.status).toBe('arrived'); expect(f.state().logs).toHaveLength(0)
  })
  it('部分扫码不能自动当作全部箱数已确认，明确短收原因后才可清点', async () => {
    const f = fixture(2)
    await runInboundReceiving(f.prisma, 1, 'carton-scan', { clientRequestId: randomUUID(), scanCode: 'BOX-1' }, 1)
    await expect(runInboundReceiving(f.prisma, 1, 'qc-submit', f.qc() as any, 1)).rejects.toThrow('外箱尚未扫齐')
    await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(1, '另一箱待补'), 1)
    await expect(runInboundReceiving(f.prisma, 1, 'qc-submit', f.qc() as any, 1)).resolves.toMatchObject({ status: 'pending_putaway' })
  })
  it('原箱数请求在清点后重放仍返回原结果，修改内容重放被拒绝', async () => {
    const f = fixture(), input = f.count()
    await runInboundReceiving(f.prisma, 1, 'carton-count', input, 1)
    await runInboundReceiving(f.prisma, 1, 'qc-submit', f.qc() as any, 1)
    const logCount = f.state().logs.length
    expect(await runInboundReceiving(f.prisma, 1, 'carton-count', input, 1)).toMatchObject({ duplicate: true })
    await expect(runInboundReceiving(f.prisma, 1, 'carton-count', { ...input, receivedCartonCount: 2 }, 1)).rejects.toThrow('其他内容')
    expect(f.state().order.status).toBe('pending_putaway'); expect(f.state().logs).toHaveLength(logCount)
  })
  it('同一箱用不同请求扫描仍只确认一次，重复核对也留下可重放凭据', async () => {
    const f = fixture(), first = { clientRequestId: randomUUID(), scanCode: 'BOX-1' }
    const check = { ...first, clientRequestId: randomUUID() }
    const results = await Promise.all([runInboundReceiving(f.prisma, 1, 'carton-scan', first, 1), runInboundReceiving(f.prisma, 1, 'carton-scan', check, 2)])
    expect(results.map(row => row.increment).sort()).toEqual([0, 1])
    expect(f.state().order.receivedCartonCount).toBe(1)
    expect(f.state().logs.filter((row: any) => row.action === 'start_receive')).toHaveLength(1)
    expect(await runInboundReceiving(f.prisma, 1, 'carton-scan', check, 2)).toMatchObject({ duplicate: true })
  })
  it('人工已确认箱数不能被扫码覆盖改小，也不能直接减少', async () => {
    const f = fixture(2)
    await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    await runInboundReceiving(f.prisma, 1, 'carton-scan', { clientRequestId: randomUUID(), scanCode: 'BOX-1' }, 1)
    expect(f.state().order.receivedCartonCount).toBe(2)
    await expect(runInboundReceiving(f.prisma, 1, 'carton-count', f.count(1, '改小'), 1)).rejects.toThrow('减少箱数')
  })
  it('两位人员分别扫描SKU的增量均保留，原请求重放不再增加', async () => {
    const f = fixture(); await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    const input = { clientRequestId: randomUUID(), scanCode: 'TKL9001-A1', increment: 1 }
    await Promise.all([runInboundReceiving(f.prisma, 1, 'qc-scan', input, 1), runInboundReceiving(f.prisma, 1, 'qc-scan', { ...input, clientRequestId: randomUUID() }, 2)])
    expect(f.state().order.items[0].actualQty).toBe(2)
    await runInboundReceiving(f.prisma, 1, 'qc-scan', input, 1)
    expect(f.state().order.items[0].actualQty).toBe(2)
    await expect(runInboundReceiving(f.prisma, 1, 'qc-scan', { ...input, clientRequestId: randomUUID(), scanCode: 'A1' }, 1)).rejects.toThrow('不属于')
  })
  it('清点版本过期、编号与SKU不一致、遗漏明细均拒绝且不写入任何行', async () => {
    const f = fixture(); await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    const original = f.qc()
    for (const input of [{ ...original, expectedVersion: '0'.repeat(64) }, { ...original, items: [original.items[0]] }, { ...original, items: original.items.map((row: any) => ({ ...row, sku: 'WRONG' })) }]) {
      await expect(runInboundReceiving(f.prisma, 1, 'qc-submit', input as any, 1)).rejects.toThrow()
      expect(f.state().order.items.map((row: any) => row.actualQty)).toEqual([null, null])
    }
  })
  it('清点和测量写入失败时一起回滚；原请求重试后两者同时保存且只记一次', async () => {
    const f = fixture(); await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    f.failProduct()
    await expect(runInboundReceiving(f.prisma, 1, 'qc-measure-submit', f.qc(true) as any, 1)).rejects.toThrow('数据库写入失败')
    expect(f.state().order.items.map((row: any) => row.actualQty)).toEqual([null, null]); expect(f.state().order.status).toBe('receiving')
    const g = fixture(); await runInboundReceiving(g.prisma, 1, 'carton-count', g.count(), 1)
    const input = g.qc(true)
    await runInboundReceiving(g.prisma, 1, 'qc-measure-submit', input as any, 1)
    const before = structuredClone(g.state())
    expect(await runInboundReceiving(g.prisma, 1, 'qc-measure-submit', input as any, 1)).toMatchObject({ duplicate: true, measuredCount: 2 })
    expect(g.state()).toEqual(before); expect(g.state().products[0].measuredLengthCm).toBe(10)
  })
  it('合并提交允许全部零收货；质检异常不会误放行为待上架', async () => {
    const f = fixture(); await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    const input = f.qc(); input.items = input.items.map((row: any) => ({ ...row, actualQty: 0, qcStatus: 'fail' }))
    expect(await runInboundReceiving(f.prisma, 1, 'qc-measure-submit', { ...input, expectedVersion: inboundMeasurementVersion(f.state().order, f.state().products) } as any, 1)).toMatchObject({ status: 'exception', measuredCount: 0 })
    expect(f.state().products[0].measuredLengthCm).toBeUndefined()
  })
  it('测量版本包含产品实际尺寸与重量，旧页面不能覆盖新测量', async () => {
    const f = fixture(); await runInboundReceiving(f.prisma, 1, 'carton-count', f.count(), 1)
    const input = f.qc(true)
    f.state().products[0].weightKg = 2
    await expect(runInboundReceiving(f.prisma, 1, 'qc-measure-submit', input as any, 1)).rejects.toThrow('已变更')
    await runInboundReceiving(f.prisma, 1, 'qc-submit', f.qc() as any, 1)
    const measure = { clientRequestId: randomUUID(), expectedVersion: inboundMeasurementVersion(f.state().order, f.state().products), items: [{ inboundItemId: 1, lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 3.125 }] }
    expect(await runInboundReceiving(f.prisma, 1, 'measure', measure, 1)).toMatchObject({ measuredCount: 1 })
    expect(f.state().products[0].weightKg).toBe(3.125)
  })
  it('操作标识不能跨单据或操作类型复用', async () => {
    const f = fixture(), input = f.count(); await runInboundReceiving(f.prisma, 1, 'carton-count', input, 1)
    await expect(runInboundReceiving(f.prisma, 2, 'carton-count', input, 1)).rejects.toThrow('其他内容')
    await expect(runInboundReceiving(f.prisma, 1, 'carton-scan', { clientRequestId: input.clientRequestId, scanCode: 'BOX-1' }, 1)).rejects.toThrow('其他内容')
  })
})

describe('设备输入和页面提交的严格校验', () => {
  it.each(['{"sku":"A","qty":1.5}', '{"sku":"A","qty":false}', '{"sku":"A","lengthCm":10}', '{"sku":"A","weightKg":0}', '{"sku":"A","weightKg":100000}', '{"sku":"A","weightKg":1.2345}', '{invalid', 'A|1|2|0'])('拒绝无效设备输入 %s', input => {
    expect(() => parseInboundQcScanInput(input)).toThrow(/[\u4e00-\u9fa5]/)
  })
  it('保留合法短分隔SKU，并识别有效重量', () => {
    expect(parseInboundQcScanInput('A,B')).toMatchObject({ skuToken: 'A,B', increment: 1 })
    expect(parseInboundQcScanInput('{"sku":"A","qty":2,"weightKg":1.234}')).toMatchObject({ increment: 2, weightKg: 1.234 })
  })
  it('DTO不将布尔值当作箱数或接受差异的文字当作真值', () => {
    expect(validateSync(plainToInstance(RecordInboundCartonsDto, { clientRequestId: randomUUID(), receivedCartonCount: true })).length).toBeGreaterThan(0)
    expect(validateSync(plainToInstance(SubmitInboundQcDto, { clientRequestId: randomUUID(), expectedVersion: 'a'.repeat(64), acceptDiff: 'false', items: [] })).length).toBeGreaterThan(0)
  })
  it('明细重复和部分尺寸在开始事务前拒绝', () => {
    const f = fixture(), input = f.qc()
    expect(() => normalizeReceivingInput(1, 'qc-submit', { ...input, items: [input.items[0], input.items[0]] } as any)).toThrow('重复')
    expect(() => normalizeReceivingInput(1, 'qc-measure-submit', { ...input, items: input.items.map((row: any) => ({ ...row, lengthCm: 1 })) } as any)).toThrow('完整')
  })
  it('兼容历史人工差异确认，但不把其他箱数的旧原因当作当前确认', async () => {
    const db = { operationLog: { findFirst: jest.fn().mockResolvedValue({ detail: { receivedCartonCount: 2, differenceReason: '短收一箱' } }) } }
    expect(await inboundCartonReadiness(db, { inboundNo: 'X', receivedCartonCount: 2, cartons: [{}, {}, {}] })).toMatchObject({ ready: true })
    expect(await inboundCartonReadiness(db, { inboundNo: 'X', receivedCartonCount: 1, cartons: [{}, {}, {}] })).toMatchObject({ ready: false })
  })
})
