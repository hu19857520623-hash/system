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

const account = {
  id: 'erp-customer-cus-042',
  type: 'ecommerce',
  warehouse: 'WMS-JHB-01',
  permissions: '["dashboard:read"]',
  portalUserId: null,
  portalLoginEmail: null,
  portalMustChangePassword: null,
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
  temporaryPassword: 'abcdef1',
}

function buildTransaction() {
  return {
    customer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  }
}

function rawText(call: unknown[]): string {
  const query = call[0] as { strings?: readonly string[] }
  return query.strings?.join('?') || ''
}

function rawValues(call: unknown[]): unknown[] {
  const query = call[0] as { values?: unknown[] }
  return query.values || []
}

describe('CustomerProvisioningService unified ERP/OMS provisioning', () => {
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

  it('creates ERP, OMS account, billing, and portal user in one transaction', async () => {
    tx.customer.findUnique.mockResolvedValue(null)
    tx.customer.create.mockResolvedValue(customer)
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([account])
    tx.$executeRaw.mockResolvedValue(1)

    const result = await service.create(createDto, { requirePortal: true })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.customer.create).toHaveBeenCalledTimes(1)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      customer: { customerCode: 'CUS-042' },
      oms: {
        omsId: 'erp-customer-cus-042',
        portalReady: true,
        portalLoginEmail: 'acmeportal',
        mustChangePassword: true,
      },
    })
    const serialized = JSON.stringify(
      result,
      (_key, value) => typeof value === 'bigint' ? Number(value) : value,
    )
    expect(serialized).not.toContain('abcdef1')
    expect(serialized).not.toContain('bcrypt-hash')

    const accountInsert = tx.$executeRaw.mock.calls[0]
    expect(rawText(accountInsert)).toContain('oms_customeraccount')
    expect(rawValues(accountInsert)).toContain('erp-customer-cus-042')

    const portalInsert = tx.$executeRaw.mock.calls[2]
    expect(rawText(portalInsert)).toContain('oms_portaluser')
    expect(rawValues(portalInsert)).toContain('erp-portal-cus-042')
    expect(rawValues(portalInsert)).toContain('acmeportal')
    expect(rawValues(portalInsert)).toContain('bcrypt-hash')
    expect(rawValues(portalInsert)).not.toContain('abcdef1')
  })

  it('rejects a duplicate ERP customer code before shared writes', async () => {
    tx.customer.findUnique.mockResolvedValue(customer)

    await expect(service.create(createDto, { requirePortal: true }))
      .rejects.toBeInstanceOf(ConflictException)
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('rejects a normalized duplicate portal login email', async () => {
    tx.customer.findUnique.mockResolvedValue(null)
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'portal-existing',
        customerId: 'oms-existing',
        username: 'acmeportal',
      }])

    await expect(service.create(createDto, { requirePortal: true }))
      .rejects.toThrow('OMS 登录账号已存在')
    expect(tx.customer.create).not.toHaveBeenCalled()
  })

  it('propagates a portal write failure through the transaction for rollback', async () => {
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
      .mockResolvedValueOnce([account])
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('portal insert failed'))

    await expect(service.create(createDto, { requirePortal: true }))
      .rejects.toThrow('客户与 OMS 账户同步失败')
    expect(tx.customer.create).toHaveBeenCalled()
    expect(rolledBack).toBe(true)
  })

  it('syncs ERP master/status while preserving OMS-only settings on edit', async () => {
    const disabled = {
      ...customer,
      customerName: 'Acme Updated',
      contactPhone: '456',
      status: 0,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }
    tx.customer.findUnique.mockResolvedValue(customer)
    tx.customer.update.mockResolvedValue(disabled)
    tx.$queryRaw.mockResolvedValue([{
      ...account,
      type: 'hybrid',
      warehouse: 'WMS-CPT-01',
      permissions: '["catalog:read"]',
      portalUserId: 'erp-portal-cus-042',
      portalLoginEmail: 'acmeportal',
      portalMustChangePassword: 0,
    }])
    tx.$executeRaw.mockResolvedValue(1)

    await service.update(42, {
      customerName: 'Acme Updated',
      contactPhone: '456',
      status: 0,
    })

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
    const accountUpdate = tx.$executeRaw.mock.calls[0]
    expect(rawValues(accountUpdate)).toEqual(expect.arrayContaining([
      'disabled',
      'hybrid',
      'WMS-CPT-01',
      '["catalog:read"]',
    ]))
    const portalUpdate = tx.$executeRaw.mock.calls[2]
    expect(rawText(portalUpdate)).toContain('oms_portaluser')
    expect(rawValues(portalUpdate)).toEqual(expect.arrayContaining([
      'hybrid',
      'disabled',
      'erp-portal-cus-042',
    ]))
  })

  it('resets the portal hash and requires a password change', async () => {
    tx.customer.findUnique.mockResolvedValue(customer)
    tx.$queryRaw
      .mockResolvedValueOnce([{
        ...account,
        portalUserId: 'erp-portal-cus-042',
        portalLoginEmail: 'acmeportal',
        portalMustChangePassword: 0,
      }])
      .mockResolvedValueOnce([])
    tx.$executeRaw.mockResolvedValue(1)

    const result = await service.resetTemporaryPassword(
      { id: BigInt(42) },
      { username: 'acmeportal', temporaryPassword: 'reset1' },
    )

    expect(result.oms).toMatchObject({
      portalLoginEmail: 'acmeportal',
      mustChangePassword: true,
    })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    const update = tx.$executeRaw.mock.calls[0]
    expect(rawText(update)).toContain('mustChangePassword')
    expect(rawValues(update)).toContain('bcrypt-hash')
    expect(rawValues(update)).not.toContain('reset1')
  })
})
