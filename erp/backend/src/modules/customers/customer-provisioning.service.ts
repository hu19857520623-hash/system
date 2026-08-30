import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type Customer } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import {
  resolveOmsPermissions,
  type OmsCustomerType,
  type OmsPortalPermission,
} from '@erp/shared/oms-portal.permissions'
import { PrismaService } from '../../common/prisma/prisma.service'
import {
  CreateCustomerDto,
  SetPortalTemporaryPasswordDto,
  UpdateCustomerDto,
} from './dto/customer.dto'

const BCRYPT_ROUNDS = 12

type OmsAccountProvisioningRow = {
  id: string
  type: string
  warehouse: string
  permissions: string
  portalUserId: string | null
  portalUsername: string | null
  portalLoginEmail: string | null
  portalMustChangePassword: boolean | number | null
}

type PortalUserLookupRow = {
  id: string
  customerId: string
  username: string
}

type PortalConfiguration = {
  portalType: OmsCustomerType
  warehouse: string
  permissions: OmsPortalPermission[]
  username: string
}

export type ProvisionedOmsAccount = {
  omsId: string
  portalUserId: string | null
  type: OmsCustomerType
  warehouse: string
  permissions: OmsPortalPermission[]
  omsStatus: 'active' | 'disabled'
  portalReady: boolean
  portalUsername: string | null
  portalLoginEmail: string | null
  portalStatus: 'active' | 'disabled' | null
  mustChangePassword: boolean | null
}

export type CustomerProvisioningResult = {
  customer: Customer
  oms: ProvisionedOmsAccount | null
}

@Injectable()
export class CustomerProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateCustomerDto,
    options: {
      requirePortal: boolean
      afterCreate?: (tx: Prisma.TransactionClient, customer: Customer) => Promise<void>
    } = { requirePortal: false },
  ): Promise<CustomerProvisioningResult> {
    const portalInput = this.resolveCreatePortalInput(data, options.requirePortal)
    const passwordHash = portalInput
      ? await this.hashTemporaryPassword(portalInput.temporaryPassword)
      : undefined
    const portal = portalInput
      ? {
          portalType: portalInput.portalType,
          warehouse: portalInput.warehouse,
          permissions: portalInput.permissions,
          username: portalInput.username,
        }
      : undefined

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customerCode = data.customerCode.trim()
        const duplicateCustomer = await tx.customer.findUnique({ where: { customerCode } })
        if (duplicateCustomer) {
          throw new ConflictException(`客户代码 ${customerCode} 已存在`)
        }

        if (portal) {
          const existingOmsAccount = await this.findOmsAccount(tx, customerCode)
          await this.assertUsernameAvailable(tx, portal.username, existingOmsAccount?.id)
        }

        const customer = await tx.customer.create({
          data: {
            customerCode,
            customerName: data.customerName.trim(),
            companyName: data.companyName?.trim() || undefined,
            contactEmail: data.contactEmail ? this.normalizeEmail(data.contactEmail) : undefined,
            contactName: data.contactName?.trim() || undefined,
            contactPhone: data.contactPhone?.trim() || undefined,
            status: data.status ?? 1,
            balance: data.balance ?? 0,
          },
        })

        const oms = portal && passwordHash
          ? await this.upsertOmsRows(tx, customer, portal, passwordHash)
          : null
        if (options.afterCreate) await options.afterCreate(tx, customer)
        return { customer, oms }
      })
    } catch (error) {
      this.rethrowProvisioningError(error)
    }
  }

  async update(id: number, data: UpdateCustomerDto): Promise<CustomerProvisioningResult> {
    const requestedPortalType = this.resolvePortalType(data)
    const requestedPermissions = this.resolveRequestedPermissions(
      data.permissionTemplate,
      data.permissions,
      false,
    )
    const normalizedUsername = data.username || data.loginEmail
      ? this.requireUsername(data.username || data.loginEmail)
      : undefined
    const passwordHash = data.temporaryPassword
      ? await this.hashTemporaryPassword(data.temporaryPassword)
      : undefined
    const hasPortalFields = this.hasPortalFields(data)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findUnique({ where: { id: BigInt(id) } })
        if (!existing) throw new NotFoundException('客户不存在')

        const customer = await tx.customer.update({
          where: { id: BigInt(id) },
          data: {
            customerName: data.customerName?.trim(),
            companyName: data.companyName?.trim(),
            contactEmail: data.contactEmail ? this.normalizeEmail(data.contactEmail) : undefined,
            contactName: data.contactName?.trim(),
            contactPhone: data.contactPhone?.trim(),
            status: data.status,
            balance: data.balance,
          },
        })

        const account = await this.findOmsAccount(tx, customer.customerCode)
        if (!account) {
          if (!hasPortalFields) return { customer, oms: null }
          const newPortal = this.resolveUpdatePortalInput(data)
          const newPasswordHash = passwordHash
            || await this.hashTemporaryPassword(newPortal.temporaryPassword)
          await this.assertUsernameAvailable(tx, newPortal.username)
          const oms = await this.upsertOmsRows(
            tx,
            customer,
            {
              portalType: newPortal.portalType,
              warehouse: newPortal.warehouse,
              permissions: newPortal.permissions,
              username: newPortal.username,
            },
            newPasswordHash,
          )
          return { customer, oms }
        }

        if (normalizedUsername) {
          await this.assertUsernameAvailable(tx, normalizedUsername, account.id)
        }

        const portalType = requestedPortalType || this.asPortalType(account.type)
        const warehouse = data.warehouse?.trim() || account.warehouse
        const permissions = requestedPermissions
          || this.parseStoredPermissions(account.permissions)
        const permissionsJson = requestedPermissions
          ? JSON.stringify(requestedPermissions)
          : account.permissions
        const status = this.toOmsStatus(customer.status)

        await tx.$executeRaw(Prisma.sql`
          UPDATE \`oms_customeraccount\`
          SET \`name\` = ${customer.customerName},
              \`companyName\` = ${customer.companyName},
              \`contact\` = ${customer.contactName || ''},
              \`contactPhone\` = ${customer.contactPhone},
              \`email\` = ${customer.contactEmail || ''},
              \`status\` = ${status},
              \`type\` = ${portalType},
              \`warehouse\` = ${warehouse},
              \`permissions\` = ${permissionsJson}
          WHERE \`id\` = ${account.id}
        `)

        await this.upsertBillingAccount(tx, customer, account.id, warehouse)

        let portalUsername = account.portalUsername || account.portalLoginEmail
        let portalUserId = account.portalUserId
        let portalReady = Boolean(account.portalUserId)
        let mustChangePassword: boolean | null = account.portalUserId
          ? Boolean(account.portalMustChangePassword)
          : null
        if (account.portalUserId) {
          const now = new Date().toISOString()
          if (passwordHash) {
            await tx.$executeRaw(Prisma.sql`
              UPDATE \`oms_portaluser\`
              SET \`username\` = COALESCE(${normalizedUsername || null}, \`username\`),
                  \`passwordHash\` = ${passwordHash},
                  \`role\` = ${portalType},
                  \`status\` = ${status},
                  \`mustChangePassword\` = TRUE,
                  \`updatedAt\` = ${now}
              WHERE \`id\` = ${account.portalUserId}
            `)
            mustChangePassword = true
          } else {
            await tx.$executeRaw(Prisma.sql`
              UPDATE \`oms_portaluser\`
              SET \`username\` = COALESCE(${normalizedUsername || null}, \`username\`),
                  \`role\` = ${portalType},
                  \`status\` = ${status},
                  \`updatedAt\` = ${now}
              WHERE \`id\` = ${account.portalUserId}
            `)
          }
          portalUsername = normalizedUsername || account.portalUsername || account.portalLoginEmail
        } else if (normalizedUsername || passwordHash) {
          if (!normalizedUsername || !passwordHash) {
            throw new BadRequestException(
              '首次创建 OMS 登录用户时必须同时提供 username 和 temporaryPassword',
            )
          }
          portalUserId = await this.savePortalUser(
            tx,
            account.id,
            customer.customerCode,
            normalizedUsername,
            passwordHash,
            portalType,
            status,
          )
          portalUsername = normalizedUsername
          portalReady = true
          mustChangePassword = true
        }

        return {
          customer,
          oms: {
            omsId: account.id,
            portalUserId,
            type: portalType,
            warehouse,
            permissions,
            omsStatus: status,
            portalReady,
            portalUsername,
            portalLoginEmail: portalUsername,
            portalStatus: portalReady ? status : null,
            mustChangePassword,
          },
        }
      })
    } catch (error) {
      this.rethrowProvisioningError(error)
    }
  }

  async resetTemporaryPassword(
    where: Prisma.CustomerWhereUniqueInput,
    data: SetPortalTemporaryPasswordDto,
  ): Promise<CustomerProvisioningResult> {
    const username = this.requireUsername(data.username || data.loginEmail)
    const passwordHash = await this.hashTemporaryPassword(data.temporaryPassword)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where })
        if (!customer) throw new NotFoundException('客户不存在')

        const account = await this.findOmsAccount(tx, customer.customerCode)
        if (!account) throw new BadRequestException('该客户尚未开通 OMS 账户')

        await this.assertUsernameAvailable(tx, username, account.id)
        const portalType = this.asPortalType(account.type)
        const status = this.toOmsStatus(customer.status)
        const portalUserId = await this.savePortalUser(
          tx,
          account.id,
          customer.customerCode,
          username,
          passwordHash,
          portalType,
          status,
          account.portalUserId,
        )

        return {
          customer,
          oms: {
            omsId: account.id,
            portalUserId,
            type: portalType,
            warehouse: account.warehouse,
            permissions: this.parseStoredPermissions(account.permissions),
            omsStatus: status,
            portalReady: true,
            portalUsername: username,
            portalLoginEmail: username,
            portalStatus: status,
            mustChangePassword: true,
          },
        }
      })
    } catch (error) {
      this.rethrowProvisioningError(error)
    }
  }

  private resolveCreatePortalInput(
    data: CreateCustomerDto,
    required: boolean,
  ): PortalConfiguration & { temporaryPassword: string } | undefined {
    if (!this.hasPortalFields(data)) {
      if (required) throw new BadRequestException('OMS 开户信息不完整')
      return undefined
    }

    const portalType = this.resolvePortalType(data)
    const permissions = this.resolveRequestedPermissions(
      data.permissionTemplate,
      data.permissions,
      true,
    )
    if (
      !portalType ||
      !data.warehouse?.trim() ||
      !this.portalIdentity(data) ||
      !data.temporaryPassword ||
      !permissions
    ) {
      throw new BadRequestException(
        'OMS 开户必须提供 portalType、warehouse、权限、username 和 temporaryPassword',
      )
    }
    return {
      portalType,
      warehouse: data.warehouse.trim(),
      permissions,
      username: this.requireUsername(this.portalIdentity(data)),
      temporaryPassword: data.temporaryPassword,
    }
  }

  private resolveUpdatePortalInput(
    data: UpdateCustomerDto,
  ): PortalConfiguration & { temporaryPassword: string } {
    const portalType = this.resolvePortalType(data)
    const permissions = this.resolveRequestedPermissions(
      data.permissionTemplate,
      data.permissions,
      true,
    )
    if (
      !portalType ||
      !data.warehouse?.trim() ||
      !this.portalIdentity(data) ||
      !data.temporaryPassword ||
      !permissions
    ) {
      throw new BadRequestException(
        '首次开通 OMS 时必须提供 portalType、warehouse、权限、username 和 temporaryPassword',
      )
    }
    return {
      portalType,
      warehouse: data.warehouse.trim(),
      permissions,
      username: this.requireUsername(this.portalIdentity(data)),
      temporaryPassword: data.temporaryPassword,
    }
  }

  private resolvePortalType(data: {
    portalType?: OmsCustomerType
    omsType?: OmsCustomerType
  }): OmsCustomerType | undefined {
    if (data.portalType && data.omsType && data.portalType !== data.omsType) {
      throw new BadRequestException('portalType 与兼容字段 omsType 不一致')
    }
    return data.portalType || data.omsType
  }

  private hasPortalFields(data: {
    portalType?: OmsCustomerType
    omsType?: OmsCustomerType
    warehouse?: string
    permissionTemplate?: OmsCustomerType
    permissions?: OmsPortalPermission[]
    username?: string
    loginEmail?: string
    temporaryPassword?: string
  }): boolean {
    return [
      data.portalType,
      data.omsType,
      data.warehouse,
      data.permissionTemplate,
      data.permissions,
      data.username,
      data.loginEmail,
      data.temporaryPassword,
    ].some((value) => value !== undefined)
  }

  private portalIdentity(data: { username?: string; loginEmail?: string }): string | undefined {
    return data.username || data.loginEmail
  }

  private resolveRequestedPermissions(
    template: OmsCustomerType | undefined,
    explicit: OmsPortalPermission[] | undefined,
    required: boolean,
  ): OmsPortalPermission[] | undefined {
    if (template && explicit !== undefined) {
      throw new BadRequestException('权限模板与显式权限只能选择一种')
    }
    if (!template && explicit === undefined) {
      if (required) throw new BadRequestException('请选择权限模板或显式权限')
      return undefined
    }
    return resolveOmsPermissions(template, explicit)
  }

  private async hashTemporaryPassword(password: string): Promise<string> {
    if (password.length < 6 || password.length > 128) {
      throw new BadRequestException('临时密码须为 6-128 位')
    }
    return bcrypt.hash(password, BCRYPT_ROUNDS)
  }

  private async upsertOmsRows(
    tx: Prisma.TransactionClient,
    customer: Customer,
    portal: PortalConfiguration,
    passwordHash: string,
  ): Promise<ProvisionedOmsAccount> {
    const accountId = this.stableOmsId('customer', customer.customerCode)
    const status = this.toOmsStatus(customer.status)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO \`oms_customeraccount\`
        (\`id\`, \`name\`, \`code\`, \`type\`, \`contact\`, \`email\`, \`status\`,
         \`permissions\`, \`warehouse\`, \`createdAt\`, \`lastLoginAt\`,
         \`companyName\`, \`contactPhone\`)
      VALUES (
        ${accountId},
        ${customer.customerName},
        ${customer.customerCode},
        ${portal.portalType},
        ${customer.contactName || ''},
        ${customer.contactEmail || ''},
        ${status},
        ${JSON.stringify(portal.permissions)},
        ${portal.warehouse},
        ${new Date().toISOString()},
        '',
        ${customer.companyName},
        ${customer.contactPhone}
      )
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`type\` = VALUES(\`type\`),
        \`contact\` = VALUES(\`contact\`),
        \`email\` = VALUES(\`email\`),
        \`status\` = VALUES(\`status\`),
        \`permissions\` = VALUES(\`permissions\`),
        \`warehouse\` = VALUES(\`warehouse\`),
        \`companyName\` = VALUES(\`companyName\`),
        \`contactPhone\` = VALUES(\`contactPhone\`)
    `)

    const account = await this.findOmsAccount(tx, customer.customerCode)
    if (!account) {
      throw new Error('OMS customer account provisioning did not produce an account')
    }

    await this.upsertBillingAccount(tx, customer, account.id, portal.warehouse)
    const portalUserId = await this.savePortalUser(
      tx,
      account.id,
      customer.customerCode,
      portal.username,
      passwordHash,
      portal.portalType,
      status,
      account.portalUserId,
    )

    return {
      omsId: account.id,
      portalUserId,
      type: portal.portalType,
      warehouse: portal.warehouse,
      permissions: portal.permissions,
      omsStatus: status,
      portalReady: true,
      portalUsername: portal.username,
      portalLoginEmail: portal.username,
      portalStatus: status,
      mustChangePassword: true,
    }
  }

  private async upsertBillingAccount(
    tx: Prisma.TransactionClient,
    customer: Customer,
    accountId: string,
    warehouse: string,
  ): Promise<void> {
    const billingId = this.stableOmsId('billing', customer.customerCode)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO \`oms_billingaccount\`
        (\`id\`, \`customerId\`, \`name\`, \`code\`, \`contact\`, \`warehouse\`,
         \`creditBalance\`, \`monthlySpent\`, \`pendingBill\`, \`budgetUsed\`)
      VALUES (
        ${billingId},
        ${accountId},
        ${customer.customerName},
        ${customer.customerCode},
        ${customer.contactName || ''},
        ${warehouse},
        ${Number(customer.balance)},
        0,
        0,
        0
      )
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`code\` = VALUES(\`code\`),
        \`contact\` = VALUES(\`contact\`),
        \`warehouse\` = VALUES(\`warehouse\`),
        \`creditBalance\` = VALUES(\`creditBalance\`)
    `)
  }

  private async savePortalUser(
    tx: Prisma.TransactionClient,
    accountId: string,
    customerCode: string,
    username: string,
    passwordHash: string,
    portalType: OmsCustomerType,
    status: 'active' | 'disabled',
    existingPortalUserId?: string | null,
  ): Promise<string> {
    const now = new Date().toISOString()
    if (existingPortalUserId) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE \`oms_portaluser\`
        SET \`username\` = ${username},
            \`passwordHash\` = ${passwordHash},
            \`role\` = ${portalType},
            \`status\` = ${status},
            \`mustChangePassword\` = TRUE,
            \`updatedAt\` = ${now}
        WHERE \`id\` = ${existingPortalUserId}
      `)
      return existingPortalUserId
    }

    const portalUserId = this.stableOmsId('portal', customerCode)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO \`oms_portaluser\`
        (\`id\`, \`customerId\`, \`username\`, \`passwordHash\`, \`role\`, \`status\`,
         \`mustChangePassword\`, \`createdAt\`, \`updatedAt\`, \`lastLoginAt\`)
      VALUES (
        ${portalUserId},
        ${accountId},
        ${username},
        ${passwordHash},
        ${portalType},
        ${status},
        TRUE,
        ${now},
        ${now},
        NULL
      )
    `)
    return portalUserId
  }

  private async findOmsAccount(
    tx: Prisma.TransactionClient,
    customerCode: string,
  ): Promise<OmsAccountProvisioningRow | undefined> {
    const rows = await tx.$queryRaw<OmsAccountProvisioningRow[]>(Prisma.sql`
      SELECT c.\`id\`, c.\`type\`, c.\`warehouse\`, c.\`permissions\`,
             u.\`id\` AS \`portalUserId\`,
             u.\`username\` AS \`portalUsername\`,
             u.\`username\` AS \`portalLoginEmail\`,
             u.\`mustChangePassword\` AS \`portalMustChangePassword\`
      FROM \`oms_customeraccount\` c
      LEFT JOIN \`oms_portaluser\` u ON u.\`customerId\` = c.\`id\`
      WHERE c.\`code\` = ${customerCode}
      LIMIT 1
    `)
    return rows[0]
  }

  private async assertUsernameAvailable(
    tx: Prisma.TransactionClient,
    username: string,
    currentAccountId?: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<PortalUserLookupRow[]>(Prisma.sql`
      SELECT \`id\`, \`customerId\`, \`username\`
      FROM \`oms_portaluser\`
      WHERE \`username\` = ${username}
        AND (${currentAccountId || null} IS NULL OR \`customerId\` <> ${currentAccountId || null})
      LIMIT 1
    `)
    if (rows.length) throw new ConflictException('OMS 登录账号已存在')
  }

  private parseStoredPermissions(raw: string): OmsPortalPermission[] {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed as OmsPortalPermission[] : []
    } catch {
      return []
    }
  }

  private asPortalType(value: string): OmsCustomerType {
    if (value === 'ecommerce' || value === 'catalog' || value === 'hybrid') return value
    throw new BadRequestException(`OMS 账户类型 ${value} 无效`)
  }

  private normalizeUsername(value: string): string {
    return value.trim().toLowerCase()
  }

  private requireUsername(value: string | undefined): string {
    const username = this.normalizeUsername(value || '')
    if (
      username.length < 6
      || username.length > 50
      || !/^[A-Za-z0-9._-]+$/.test(username)
    ) {
      throw new BadRequestException('OMS 登录账号须为 6-50 位字母、数字、点、下划线或短横线')
    }
    return username
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase()
  }

  private stableOmsId(kind: 'customer' | 'billing' | 'portal', customerCode: string): string {
    return `erp-${kind}-${customerCode.trim().toLowerCase()}`
  }

  private toOmsStatus(status: number): 'active' | 'disabled' {
    return status === 1 ? 'active' : 'disabled'
  }

  private rethrowProvisioningError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      throw error
    }
    const prismaError = error as {
      code?: string
      meta?: { code?: string | number }
    }
    if (
      prismaError?.code === 'P2002' ||
      (prismaError?.code === 'P2010' && String(prismaError.meta?.code) === '1062') ||
      prismaError?.code === 'ER_DUP_ENTRY'
    ) {
      throw new ConflictException('客户代码或 OMS 登录账号已存在')
    }
    throw new InternalServerErrorException('客户与 OMS 账户同步失败')
  }
}
