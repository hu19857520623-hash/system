import { assertGlobalSkuAvailable } from './global-sku.util'

describe('global SKU uniqueness', () => {
  it('rejects an ERP or another customer SKU without exposing ownership details', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ code: 'TKL005-NN0002' }]) }
    await expect(assertGlobalSkuAvailable(db, { sku: 'TKL006-NN0002', customerSku: 'NN0002' })).rejects.toThrow('全局不可重复')
    const query = db.$queryRaw.mock.calls[0][0]
    expect(query.sql).toContain('UNION ALL')
    expect(query.sql).toContain('customer_sku IN')
    expect(query.sql).toContain('customerSku IN')
    expect(query.values).toContain('NN0002')
  })

  it('checks the base SKU when an ERP SKU already has a catalog prefix', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) }
    await assertGlobalSkuAvailable(db, { sku: 'TKL-ABC123' })
    expect(db.$queryRaw.mock.calls[0][0].values).toContain('ABC123')
  })

  it('allows saving the same ERP/OMS identity while checking other identities', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) }
    await assertGlobalSkuAvailable(db, { sku: 'TKL005-ABC123', customerSku: 'ABC123', excludeErpSku: 'TKL005-ABC123', excludeOmsId: 'p1', mirrorOmsSku: 'TKL005-ABC123' })
    const query = db.$queryRaw.mock.calls[0][0]
    expect(query.sql).toContain('sku <>')
    expect(query.sql).toContain('id <>')
    expect(query.values).toContain('p1')
  })
})
