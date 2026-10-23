import { SuppliersService } from './suppliers.service'

function setup() {
  const suppliers: any[] = []
  const prisma: any = {
    supplier: {
      findFirst: jest.fn(async ({ where }) => suppliers.find((row) => row.supplierName === where.supplierName) || null),
      findUnique: jest.fn(async ({ where }) => suppliers.find((row) => row.supplierCode === where.supplierCode) || null),
      create: jest.fn(async ({ data }) => {
        const row = { id: BigInt(suppliers.length + 1), ...data }
        suppliers.push(row)
        return row
      }),
    },
  }
  return { service: new SuppliersService(prisma), prisma, suppliers }
}

describe('供应商导入', () => {
  it('写入公司名称、地址和供应商代码', async () => {
    const { service, prisma } = setup()
    const result = await service.importFromCsv([
      '供应商代码,供应商名称,公司名称,地址,联系人,电话',
      'SUP-001,宁波百晟,宁波百晟钣金制造有限公司,宁波市鄞州区,黄钰涵,13800001111',
    ].join('\n'))
    expect(result).toMatchObject({ imported: 1, failed: 0 })
    expect(prisma.supplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierCode: 'SUP-001',
        supplierName: '宁波百晟',
        companyName: '宁波百晟钣金制造有限公司',
        address: '宁波市鄞州区',
      }),
    })
  })

  it('名称已存在的行失败，不覆盖原供应商', async () => {
    const { service, suppliers } = setup()
    suppliers.push({ id: 8n, supplierCode: 'SUP-OLD', supplierName: '宁波百晟' })
    const result = await service.importFromCsv([
      '供应商名称,联系人,电话,公司名称,地址',
      '宁波百晟,黄钰涵,13800001111,新公司,新地址',
    ].join('\n'))
    expect(result.imported).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0].reason).toContain('供应商名称已存在')
    expect(suppliers).toHaveLength(1)
  })
})
