import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { billingCents, billingFilters, billingGenerationSnapshot, billingSettlementSnapshot, confirmBillingOrder, generateBillingOrders, createManualBillingCharge } from './billing-workflow.util'

function fixture(mode: 'confirm' | 'generate' = 'confirm') {
  const created = new Date('2026-10-23T01:00:00Z')
  let state: any = { customer: { id: 1n, customerCode: 'TKL-TEST', customerName: '隔离客户', balance: '100.00' },
    charges: [{ id: 1n, amount: '12.40', charge_type: 'handling', source: 'erp', biz_ref: 'DO-1' }, { id: 2n, amount: '30.00', charge_type: 'outbound_ship', source: 'erp', biz_ref: 'DO-1' }, { id: 3n, amount: '10.00', charge_type: 'handling', source: 'manual', biz_ref: null }].map(c => ({ ...c, charge_no: `CHG-${c.id}`, customer_id: 1n, status: mode === 'generate' ? 'pending' : 'confirmed', billing_id: mode === 'generate' ? null : 1n, quantity: 1, unit_price: c.amount, charge_date: created, description: '实际费用' })),
    bills: mode === 'generate' ? [] : [{ id: 1n, billingNo: 'BL-TEST-1', customerId: 1n, billingMonth: '2026-10', totalAmount: '52.40', paidAmount: '0.00', status: 'pending', createdAt: created, updatedAt: created, items: [12.4, 30, 10].map((amount, i) => ({ id: BigInt(i + 1), amount: amount.toFixed(2), itemType: 'handling', quantity: 1 })) }],
    outbounds: [{ id: 1n, outboundNo: 'DO-1', customerId: 1n, shippedAt: created, status: 'shipped' }], omsOrders: [{ outboundNo: 'DO-1', settlementStatus: 'settled', actualFeesTotal: 42.4 }], omsFees: [{ id: 'erp-chg-1', refNo: 'DO-1', amount: -12.4, method: 'actual', customerCode: 'TKL-TEST' }, { id: 'erp-chg-2', refNo: 'DO-1', amount: -30, method: 'actual', customerCode: 'TKL-TEST' }], operations: [] }
  state.receipts = [{ id: 'erp-msg-fees-DO-1', title: '出库 DO-1 费用已结算', content: '实扣 ¥42.40，预扣 ¥0.00，无差额' }]
  let fail = false, queue = Promise.resolve()
  const db = (get: () => any): any => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: async (sql: string, ...values: any[]) => {
      const s = get()
      if (sql.includes('JOIN customer cust')) {
        let rows = s.charges.filter((c: any) => c.status === 'pending' && c.billing_id == null), index = 0
        if (sql.includes('c.customer_id=?')) { const id = values[index++]; rows = rows.filter((c: any) => Number(c.customer_id) === id) }
        if (sql.includes('cust.customer_code=?')) { if (s.customer.customerCode !== values[index++]) rows = [] }
        if (sql.includes('c.source=?')) { const source = values[index++]; rows = rows.filter((c: any) => c.source === source) }
        if (sql.includes('c.charge_type=?')) { const type = values[index++]; rows = rows.filter((c: any) => c.charge_type === type) }
        return rows
      }
      if (sql.includes('FOR UPDATE')) return []
      if (sql.startsWith('SELECT * FROM billing_charge WHERE billing_id')) return s.charges.filter((c: any) => c.billing_id === values[0])
      if (sql.startsWith('SELECT o.* FROM oms_outboundorder')) return s.customer.customerCode === values[1] ? s.omsOrders.filter((o: any) => o.outboundNo === values[0]) : []
      if (sql.includes('FROM oms_systemmessage')) return s.receipts.filter((r: any) => r.id === values[0])
      if (sql.includes('FROM oms_feerecord')) return s.omsFees.filter((f: any) => f.customerCode === values[0] && f.refNo === values[1])
      if (sql.startsWith('SELECT id,amount FROM billing_charge')) return s.charges.filter((c: any) => c.customer_id === values[0] && c.biz_ref === values[1] && (sql.includes("source='oms'") ? c.source === 'oms' : ['erp', 'wms'].includes(c.source)))
      throw new Error(`Unhandled query: ${sql}`)
    },
    $executeRawUnsafe: async (_sql: string, billingId: bigint, id: bigint) => {
      const charge = get().charges.find((c: any) => c.id === id)
      if (!charge || charge.status !== 'pending' || charge.billing_id != null) return 0
      Object.assign(charge, { billing_id: billingId, status: 'confirmed' });return 1
    },
    customer: { findUnique: async ({ where }: any) => where.id === get().customer.id ? get().customer : null,
      updateMany: async ({ where, data }: any) => { const c = get().customer;if (Number(c.balance) < where.balance.gte) return { count: 0 };c.balance = (Number(c.balance) - data.balance.decrement).toFixed(2);return { count: 1 } } },
    outboundOrder: { findMany: async ({ where }: any) => get().outbounds.filter((o: any) => o.customerId === where.customerId && where.outboundNo.in.includes(o.outboundNo)) },
    omsCatalogOrder: { findMany: async () => get().purchases || [] },
    billingOrder: { findUnique: async ({ where }: any) => get().bills.find((b: any) => b.id === where.id) || null,
      update: async ({ where, data }: any) => Object.assign(get().bills.find((b: any) => b.id === where.id), data),
      create: async ({ data }: any) => { const bill = { id: BigInt(get().bills.length + 1), paidAmount: '0.00', ...data, items: data.items.create.map((i: any, index: number) => ({ id: BigInt(index + 1), ...i })) };get().bills.push(bill);return bill } },
    operationLog: { findFirst: async ({ where }: any) => [...get().operations].reverse().find((o: any) => o.module === where.module && (!where.action || (typeof where.action === 'string' ? o.action === where.action : where.action.in.includes(o.action))) && (!where.targetId || o.targetId === where.targetId) && (!where.operatorId || o.operatorId === where.operatorId) && (!where.detail || o.detail.clientRequestId === where.detail.equals)) || null,
      create: async ({ data }: any) => { if (fail) throw new Error('账务凭据末尾写入失败');const op = { id: BigInt(get().operations.length + 1), ...data };get().operations.push(op);return op } },
  })
  const prisma: any = db(() => state)
  prisma.$transaction = (callback: any) => {
    const result = queue.then(async () => { const draft = structuredClone(state);const result = await callback(db(() => draft));state = draft;return result })
    queue = result.then(() => undefined, () => undefined);return result
  }
  const preview = (id = 1) => billingSettlementSnapshot(prisma, id)
  const confirm = async (input?: any, actor = 1, id = 1) => confirmBillingOrder(prisma, id, input || { clientRequestId: randomUUID(), expectedVersion: (await preview(id)).expectedVersion }, actor)
  const generatePayload = async (filters = {}) => ({ ...filters, clientRequestId: randomUUID(), expectedVersion: (await billingGenerationSnapshot(prisma, filters)).expectedVersion })
  return { prisma, preview, confirm, generatePayload, state: () => state, fail: (value: boolean) => { fail = value } }
}

describe('账单生成与仅扣未付费用', () => {
  it('货盘采购已在订单事务扣款时不重复扣，凭据不全也不猜测为未付', async () => {
    const f = fixture();Object.assign(f.state().charges[2], { source: 'oms', charge_type: 'catalog_purchase', biz_ref: 'BUY-1' })
    f.state().purchases = [{ orderNo: 'BUY-1', customerCode: 'TKL-TEST', status: 'confirmed', totalAmount: '10.00', balanceBefore: '100.00', balanceAfter: '90.00' }]
    expect(await f.preview()).toMatchObject({ alreadyPaidAmount: 52.4, toDeductAmount: 0, canConfirm: true })
    f.state().purchases[0].balanceAfter = '95.00'
    expect((await f.preview()).canConfirm).toBe(false)
    await expect(f.confirm()).rejects.toThrow('采购已付记录不完整')
  })
  it('明确拆分已付42.40和未付10.00，确认只扣10.00并保存逐笔凭据', async () => {
    const f = fixture();expect(await f.preview()).toMatchObject({ totalAmount: 52.4, alreadyPaidAmount: 42.4, toDeductAmount: 10, remainingBalance: 90, canConfirm: true })
    expect(await f.confirm()).toMatchObject({ deductedAmount: 10, status: 'paid', paidAmount: 52.4, balanceAfter: 90 })
    expect(f.state().customer.balance).toBe('90.00');expect(f.state().operations[0].detail.allocations.map((l: any) => l.toDeductAmount)).toEqual([0, 0, 10])
  })
  it('原请求重放不再次扣款，即使余额已被其他业务改变', async () => {
    const f = fixture(), input = { clientRequestId: randomUUID(), expectedVersion: (await f.preview()).expectedVersion }
    await f.confirm(input);f.state().customer.balance = '80.00';const before = structuredClone(f.state())
    expect(await f.confirm(input)).toMatchObject({ duplicate: true });expect(f.state()).toEqual(before)
    await expect(f.confirm({ ...input, expectedVersion: 'f'.repeat(64) })).rejects.toThrow('原账务操作')
  })
  it('不同操作者并发确认同一单只扣一次，另一次读取已完成支付', async () => {
    const f = fixture(), version = (await f.preview()).expectedVersion
    const results = await Promise.all([f.confirm({ clientRequestId: randomUUID(), expectedVersion: version }, 1), f.confirm({ clientRequestId: randomUUID(), expectedVersion: version }, 2)])
    expect(results.filter(r => r.duplicate)).toHaveLength(1);expect(f.state().customer.balance).toBe('90.00');expect(f.state().operations).toHaveLength(1)
  })
  it('余额不足保留账单待确认，不修改余额或凭据', async () => {
    const f = fixture();f.state().customer.balance = '5.00';const before = structuredClone(f.state())
    expect(await f.preview()).toMatchObject({ canConfirm: false, toDeductAmount: 10, balanceSufficient: false })
    await expect(f.confirm()).rejects.toThrow('余额不足');expect(f.state()).toEqual(before)
  })
  it('末尾支付凭据失败时余额、已付金额和状态全部回滚', async () => {
    const f = fixture(), before = structuredClone(f.state());f.fail(true)
    await expect(f.confirm()).rejects.toThrow('账务凭据末尾写入失败');expect(f.state()).toEqual(before)
  })
  it('余额或费用变化使旧确认预览失效', async () => {
    const f = fixture(), input = { clientRequestId: randomUUID(), expectedVersion: (await f.preview()).expectedVersion }
    f.state().customer.balance = '99.00';await expect(f.confirm(input)).rejects.toThrow('余额已变化')
    expect(f.state().customer.balance).toBe('99.00');expect(f.state().operations).toHaveLength(0)
  })
  it.each(['cancelled', 'receipt-missing', 'receipt-amount', 'receipt-title'] as const)('历史出库支付凭据%s不完整时不猜测为未付并再次扣款', async issue => {
    const f = fixture()
    if (issue === 'receipt-missing') f.state().receipts = []
    if (issue === 'receipt-amount') f.state().receipts[0].content = '实扣 ¥40.00，预扣 ¥0.00，无差额'
    if (issue === 'receipt-title') f.state().receipts[0].title = '出库 OTHER 费用已结算'
    if (issue === 'cancelled') f.state().outbounds[0].status = 'cancelled'
    expect((await f.preview()).blockedReasons.length).toBeGreaterThan(0)
    await expect(f.confirm()).rejects.toThrow(/核对/);expect(f.state().customer.balance).toBe('100.00')
  })
  it('可回写的OMS缓存不能伪造或抹去服务端实扣凭据', async () => {
    const f = fixture();f.state().omsFees = [];f.state().omsOrders[0].actualFeesTotal = 999
    expect(await f.preview()).toMatchObject({ alreadyPaidAmount: 42.4, toDeductAmount: 10 })
    f.state().receipts = [];f.state().omsFees = [{ id: 'erp-chg-1', amount: -12.4 }];f.state().omsOrders[0].settlementStatus = 'settled'
    expect((await f.preview()).canConfirm).toBe(false)
  })
  it('手工费用借用出库单号和伪造JSON支付标记也仍按未付处理', async () => {
    const f = fixture();f.state().charges[2].biz_ref = 'DO-1';f.state().charges[2].calc_basis = { payment: { paidAmount: 10 } }
    expect(await f.confirm()).toMatchObject({ deductedAmount: 10 })
  })
  it('已有全额支付的旧账单不扣款，客户其他业务欠款不阻碍零扣款核对', async () => {
    const f = fixture();Object.assign(f.state().bills[0], { status: 'paid', paidAmount: '52.40' });f.state().customer.balance = '-1.00'
    expect(await f.confirm()).toMatchObject({ deductedAmount: 0, balanceAfter: -1 })
  })
  it('历史部分支付缺逐笔凭据时阻止重复结算', async () => {
    const f = fixture();f.state().bills[0].paidAmount = '5.00'
    await expect(f.confirm()).rejects.toThrow('历史部分支付');expect(f.state().customer.balance).toBe('100.00')
  })
  it('已入账但尚未实际支付的旧账单可以继续扣未付部分', async () => {
    const f = fixture();f.state().bills[0].status = 'confirmed'
    expect(await f.confirm()).toMatchObject({ deductedAmount: 10, status: 'paid' })
  })
  it('明细合计或客户归属不一致时不能扣款', async () => {
    const f = fixture();f.state().bills[0].items[0].amount = '12.00'
    await expect(f.confirm()).rejects.toThrow('合计与关联费用不一致')
    const g = fixture();g.state().charges[2].customer_id = 2n
    await expect(g.confirm()).rejects.toThrow('合计与关联费用不一致')
  })
  it('缺少费用关联的旧账单不自动猜测为未付', async () => {
    const f = fixture();f.state().charges = []
    await expect(f.confirm()).rejects.toThrow('合计与关联费用不一致')
  })
  it('生成账单冻结费用范围，原请求在生成后重放不新建账单', async () => {
    const f = fixture('generate'), input = await f.generatePayload()
    expect(await generateBillingOrders(f.prisma, input, 1)).toMatchObject({ count: 1, totalCharges: 3 })
    const before = structuredClone(f.state());expect(await generateBillingOrders(f.prisma, input, 1)).toMatchObject({ duplicate: true });expect(f.state()).toEqual(before)
    await expect(generateBillingOrders(f.prisma, { ...input, source: 'manual' }, 1)).rejects.toThrow('原账务操作')
  })
  it('同一费用范围并发生成只能归入一张账单', async () => {
    const f = fixture('generate'), a = await f.generatePayload(), b = await f.generatePayload()
    const results = await Promise.allSettled([generateBillingOrders(f.prisma, a, 1), generateBillingOrders(f.prisma, b, 2)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);expect(f.state().bills).toHaveLength(1);expect(f.state().charges.every((c: any) => c.billing_id === 1n)).toBe(true)
  })
  it('生成账单末尾凭据失败时费用归属和账单一起回滚', async () => {
    const f = fixture('generate'), input = await f.generatePayload(), before = structuredClone(f.state());f.fail(true)
    await expect(generateBillingOrders(f.prisma, input, 1)).rejects.toThrow('账务凭据末尾写入失败');expect(f.state()).toEqual(before)
  })
  it('预览后新增费用时要求重新预览，不能静默扩大扣费范围', async () => {
    const f = fixture('generate'), input = await f.generatePayload();f.state().charges.push({ ...f.state().charges[2], id: 4n })
    await expect(generateBillingOrders(f.prisma, input, 1)).rejects.toThrow('费用范围或入账进度已变化');expect(f.state().bills).toHaveLength(0)
  })
  it('生成请求和确认请求不能复用同一操作标识', async () => {
    const f = fixture('generate'), input = await f.generatePayload();await generateBillingOrders(f.prisma, input, 1)
    await expect(f.confirm({ clientRequestId: input.clientRequestId, expectedVersion: (await f.preview()).expectedVersion })).rejects.toThrow('原账务操作')
  })
  it('手工费用使用固定来源与服务端标识，原请求重复不会重复创建', async () => {
    const f = fixture(), input = { clientRequestId: randomUUID(), customerId: 1, amount: 2.5, chargeType: 'handling', description: '实际人工服务', chargeDate: '2026-10-23' }
    const create = jest.fn().mockResolvedValue({ id: 4, chargeNo: 'CHG-4', ok: true })
    await createManualBillingCharge(f.prisma, input, 1, create);expect(await createManualBillingCharge(f.prisma, input, 1, create)).toMatchObject({ duplicate: true })
    expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][0]).toMatchObject({ source: 'manual', idempotencyKey: `manual-billing:1:${input.clientRequestId}` })
    await expect(createManualBillingCharge(f.prisma, { ...input, amount: 3 }, 1, create)).rejects.toThrow('原账务操作')
  })
  it.each([true, -1, 1.001, Infinity, '1.00', 1e13])('拒绝无效手工金额%s，不写费用', async amount => {
    const f = fixture(), create = jest.fn()
    await expect(createManualBillingCharge(f.prisma, { clientRequestId: randomUUID(), customerId: 1, amount, chargeType: 'handling', chargeDate: '2026-10-23' }, 1, create)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
  it.each([0, undefined, -1])('无有效操作者%s不能写账务', async actor => {
    const f = fixture('generate');await expect(generateBillingOrders(f.prisma, await f.generatePayload(), actor)).rejects.toThrow('重新登录')
  })
  it('按分核算金额，校验真实日期、起止顺序和筛选范围', () => {
    expect(billingCents('12.40')).toBe(1240);expect(billingCents('0.01')).toBe(1)
    for (const value of ['1.001', true, null, 'NaN']) expect(() => billingCents(value)).toThrow()
    for (const filters of [{ dateFrom: '2026-02-30' }, { dateFrom: '2026-10-24', dateTo: '2026-10-23' }, { customerId: true }, { source: 'all' }, { chargeType: 'unknown' }]) expect(() => billingFilters(filters)).toThrow()
    expect(billingFilters({ customerCode: ' tkl-test ' })).toEqual({ customerCode: 'TKL-TEST' })
  })
})
