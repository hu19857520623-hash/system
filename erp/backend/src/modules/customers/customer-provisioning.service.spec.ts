import { ConflictException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { CustomerProvisioningService } from './customer-provisioning.service'
import type { CreateCustomerDto } from './dto/customer.dto'

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
}))

const customer = {
  id: BigInt(42),
  customerCode: 'CUS-042',
  customerName: 'Acme',
  companyName: 'Acme Ltd',
  contactEmail: 'owner@acme.test',
  contactName: 'Owner',
  contactPhone: '123',
  balance: 0,
  status: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const createDto: CreateCustomerDto = {
  customerCode: 'CUS-042',
  customerName: 'Acme',
  companyName: 'Acme Ltd',
  contactEmail: 'owner@acme.test',
  contactName: 'Owner',
  contactPhone: '123',
  portalType: 'ecommerce',
  warehouse: 'WMS-JHB-01',
  permissionTemplate: 'ecommerce',
  username: 'acmeportal',
  temporaryPassword: 'abcdef',
}

function buildTransaction() {
  return {
    customer: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  }
}

function sqlText(call: unknown[]): string {
  return String((call[0] as { sql?: string }).sql || '')
}

function sqlValues(call: unknown[]): unknown[] {
  return (call[0] as { values?: unknown[] }).values || []
}

describe('CustomerProvisioningService', () => {
  let tx: ReturnType<typeof buildTransaction>
  let prisma: { $transaction: jest.Mock }
  let service: CustomerProvisioningService

  beforeEach(() => {
    jest.clearAllMocks()
    ;(bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash')
    tx = buildTransaction()
    prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
    }
    service = new CustomerProvisioningService(prisma as any)
  })

  it('creates ERP, OMS account, billing, and portal user atomically', async () => {
    tx.customer.findUnique.mockResolvedValue(null)
    tx.customer.create.mockResolvedValue(customer)
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'erp-customer-cus-042',
        type: 'ecommerce',
        warehouse: 'WMS-JHB-01',
        permissions: '[]',
        portalUserId: null,
        portalLoginEmail: null,
        portalMustChangePassword: null,
      }])
    tx.$executeRaw.mockResolvedValue(1)

    const result = await service.create(createDto, { requirePortal: true })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.customer.create).toHaveBeenCalledTimes(1)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
    expect(result.oms).toMatchObject({
      portalReady: true,
      portalLoginEmail: 'acmeportal',
      mustChangePassword: true,
    })
    expect(bcrypt.hash).toHaveBeenCalledWith('abcdef', 12)
    const serialized = JSON.stringify(
      result,
      (_key, value) => typeof value === 'bigint' ? value.toString() : value,
    )
    expect(serialized).not.toContain(createDto.temporaryPassword)
    expect(serialized).not.toContain('bcrypt-hash')

    const portalWrite = tx.$executeRaw.mock.calls[2]
    expect(sqlText(portalWrite)).toContain('oms_portaluser')
    expect(sqlValues(portalWrite)).toContain('acmeportal')
    expect(sqlValues(portalWrite)).toContain('bcrypt-hash')
    expect(sqlValues(portalWrite)).not.toContain(createDto.temporaryPassword)
  })

  it('preserves compatibility for ERP-only create callers', async () => {
    tx.customer.findUnique.mockResolvedValue(null)
    tx.customer.create.mockResolvedValue(customer)

    const result = await service.create({
      customerCode: 'CUS-042',
      customerName: 'Acme',
    })

    expect(result.oms).toBeNull()
    expect(tx.customer.create).toHaveBeenCalledTimes(1)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })

  it('rejects a duplicate ERP customer code before shared writes', async () => {
    tx.customer.findUnique.mockResolvedValue(customer)

    await expect(
      service.create(createDto, { requirePortal: true }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('rejects a normalized duplicate portal username', async () => {
    tx.customer.findUnique.mockResolvedValue(null)
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'portal-existing',
        customerId: 'customer-existing',
        username: 'acmeportal',
      }])

    await expect(
      service.create(createDto, { requirePortal: true }),
    ).rejects.toThrow('OMS 登录账号已存在')
    expect(tx.customer.create).not.toHaveBeenCalled()
  })

  it('propagates a portal write failure so the transaction rolls back', async () => {
    let rolledBack = false
    prisma.$transaction.mockImplementation(async (callback) => {
      try {
        return await callback(tx)
      } catch (error) {
        rolledBack = true
        throw error
      }
    })
    tx.customer.findUnique.mockResolvedValue(null)
    tx.customer.create.mockResolvedValue(customer)
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'erp-customer-cus-042',
        type: 'ecommerce',
        warehouse: 'WMS-JHB-01',
        permissions: '[]',
        portalUserId: null,
        portalLoginEmail: null,
        portalMustChangePassword: null,
      }])
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('portal insert failed'))

    await expect(
      service.create(createDto, { requirePortal: true }),
    ).rejects.toThrow('客户与 OMS 账户同步失败')
    expect(tx.customer.create).toHaveBeenCalled()
    expect(rolledBack).toBe(true)
  })

  it('syncs ERP status while preserving OMS-only permissions on edit', async () => {
    const disabled = {
      ...customer,
      customerName: 'Acme Updated',
      status: 0,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }
    tx.customer.findUnique.mockResolvedValue(customer)
    tx.customer.update.mockResolvedValue(disabled)
    tx.$queryRaw.mockResolvedValue([{
      id: 'erp-customer-cus-042',
      type: 'hybrid',
      warehouse: 'WMS-CPT-01',
      permissions: '["catalog:read"]',
      portalUserId: 'erp-portal-cus-042',
      portalLoginEmail: 'acmeportal',
      portalMustChangePassword: 0,
    }])
    tx.$executeRaw.mockResolvedValue(1)

    const result = await service.update(42, {
      customerName: 'Acme Updated',
      status: 0,
    })

    expect(result.oms).toMatchObject({
      type: 'hybrid',
      warehouse: 'WMS-CPT-01',
      permissions: ['catalog:read'],
      omsStatus: 'disabled',
    })
    const accountWrite = tx.$executeRaw.mock.calls[0]
    expect(sqlText(accountWrite)).toContain('oms_customeraccount')
    expect(sqlValues(accountWrite)).toContain('["catalog:read"]')
    expect(sqlValues(accountWrite)).toContain('disabled')
  })
})
