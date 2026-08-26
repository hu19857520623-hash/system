import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type Customer } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { notifyOms } from '../../common/oms-notify.util'
import {
  buildOmsOnlyListItem,
  enrichErpWithOms,
  fetchOmsCustomerRows,
  matchesCustomerKeyword,
} from './oms-customer-bridge.util'
import {
  CustomerProvisioningService,
  type CustomerProvisioningResult,
} from './customer-provisioning.service'
import {
  CreateCustomerDto,
  SetPortalTemporaryPasswordDto,
  UpdateCustomerDto,
} from './dto/customer.dto'

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: CustomerProvisioningService,
  ) {}

  async list(q: PaginationDto & {
    status?: string
    balanceMin?: string
    balanceMax?: string
    portalOnly?: string
  }) {
    const { page, pageSize } = getPagination(q)
    const [erpRows, omsRows] = await Promise.all([
      this.prisma.customer.findMany({ orderBy: { id: 'desc' } }),
      fetchOmsCustomerRows(this.prisma),
    ])
    const omsByCode = new Map(omsRows.map((row) => [row.code, row]))
    const erpCodes = new Set(erpRows.map((row) => row.customerCode))

    const rechargeAgg = erpRows.length
      ? await this.prisma.customerRecharge.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: erpRows.map((row) => row.id) },
            status: 'confirmed',
          },
          _sum: { amount: true },
          _max: { createdAt: true },
        })
      : []
    const rechargeMap = new Map(
      rechargeAgg.map((row) => [
        Number(row.customerId),
        {
          total: Number(row._sum.amount ?? 0),
          lastAt: row._max.createdAt,
        },
      ]),
    )

    let merged = [
      ...erpRows.map((row) =>
        enrichErpWithOms(
          row,
          omsByCode.get(row.customerCode),
          rechargeMap.get(Number(row.id)),
        ),
      ),
      ...omsRows
        .filter((row) => !erpCodes.has(row.code))
        .map((row) => buildOmsOnlyListItem(row)),
    ]

    if (q.portalOnly === '1' || q.portalOnly === 'true') {
      merged = merged.filter((row) => Boolean(row.oms))
    }

    if (q.status === 'active') merged = merged.filter((row) => row.status === 1)
    else if (q.status === 'disabled') merged = merged.filter((row) => row.status === 0)

    if (q.keyword?.trim()) {
      const keyword = q.keyword.trim()
      merged = merged.filter((row) => matchesCustomerKeyword(row, keyword))
    }

    const balanceMin = q.balanceMin != null && q.balanceMin !== ''
      ? Number(q.balanceMin)
      : null
    const balanceMax = q.balanceMax != null && q.balanceMax !== ''
      ? Number(q.balanceMax)
      : null
    if (balanceMin != null && Number.isFinite(balanceMin)) {
      merged = merged.filter((row) => Number(row.balance) >= balanceMin)
    }
    if (balanceMax != null && Number.isFinite(balanceMax)) {
      merged = merged.filter((row) => Number(row.balance) <= balanceMax)
    }

    merged.sort((left, right) => {
      const leftTime = left.updatedAt instanceof Date
        ? left.updatedAt.getTime()
        : new Date(left.updatedAt).getTime()
      const rightTime = right.updatedAt instanceof Date
        ? right.updatedAt.getTime()
        : new Date(right.updatedAt).getTime()
      return rightTime - leftTime
    })

    const total = merged.length
    const items = merged.slice((page - 1) * pageSize, page * pageSize)
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.customer.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('客户不存在')
    return this.toPublicCustomer(row)
  }

  /** OMS：按客户编码查询 ERP 主数据与余额。 */
  async findByCodeForOms(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const row = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!row) throw new NotFoundException(`客户代码 ${code} 不存在`)
    return this.toPublicCustomer(row)
  }

  /** 客户持有的 SKU 库存（OMS 购买后转入）。 */
  async skuInventory(id: number) {
    await this.detail(id)
    return this.listSkuInventory(BigInt(id))
  }

  async skuInventoryByCodeForOms(customerCode: string) {
    const customer = await this.findByCodeForOms(customerCode)
    return this.listSkuInventory(BigInt(customer.id))
  }

  /** OMS P1：客户库存视图（货盘持有 + 海外仓库存）。 */
  async inventoryViewForOms(customerCode: string, warehouseCode = 'WMS-JHB-01') {
    const customer = await this.findByCodeForOms(customerCode)
    const holdings = await this.listSkuInventory(BigInt(customer.id))
    const skus = holdings.map((holding) => holding.sku)
    const products = skus.length
      ? await this.prisma.product.findMany({ where: { sku: { in: skus } } })
      : []
    const productIds = products.map((product) => product.id)
    const inventoryRows = productIds.length
      ? await this.prisma.inventory.findMany({
          where: { productId: { in: productIds }, warehouseCode },
        })
      : []
    const productBySku = new Map(products.map((product) => [product.sku, product]))
    const inventoryByProductId = new Map(
      inventoryRows.map((inventory) => [Number(inventory.productId), inventory]),
    )

    const items = holdings.map((holding) => {
      const product = productBySku.get(holding.sku)
      const inventory = product
        ? inventoryByProductId.get(Number(product.id))
        : undefined
      return {
        ...holding,
        warehouseCode,
        warehouseAvailable: inventory?.availableQty ?? 0,
        warehouseLocked: inventory?.lockedQty ?? 0,
        warehouseTotal: inventory?.totalQty ?? 0,
        stockSource: 'catalog' as const,
      }
    })

    return {
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      warehouseCode,
      items,
      total: items.length,
    }
  }

  async create(
    data: CreateCustomerDto,
    afterCreate?: (tx: Prisma.TransactionClient, customer: Customer) => Promise<void>,
  ) {
    const result = await this.provisioning.create(data, { requirePortal: true, afterCreate })
    return this.toProvisioningResponse(result)
  }

  async provisionFromOms(data: CreateCustomerDto) {
    const result = await this.provisioning.create(data, { requirePortal: true })
    return this.toInternalProvisioningResponse(result)
  }

  /**
   * 从容器内 JSON 开通/回填 OMS 门户。供生产部署在已运行的 erp-api 内触发，
   * 避免 docker compose run 写入到错误的数据库实例。
   */
  async importLegacyFromFile() {
    const dataFile = join(process.cwd(), 'data', 'customers-import.json')
    let rows: Array<Record<string, unknown>>
    try {
      rows = JSON.parse(readFileSync(dataFile, 'utf8')) as Array<Record<string, unknown>>
    } catch {
      throw new BadRequestException(`缺少导入文件: ${dataFile}`)
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('导入文件为空')
    }

    const password = process.env.IMPORT_DEFAULT_PASSWORD || 'ChangeMe123!'
    let created = 0
    let updated = 0
    let failed = 0
    const errors: Array<{ customerCode: string; message: string }> = []

    for (const raw of rows) {
      const customerCode = String(raw.customerCode || '').trim()
      if (!customerCode) {
        failed += 1
        continue
      }
      try {
        const username = this.legacyUsername(raw, customerCode)
        const payload = {
          customerCode,
          customerName: String(raw.customerName || customerCode).trim().slice(0, 200),
          companyName: raw.companyName ? String(raw.companyName).trim().slice(0, 200) : undefined,
          contactEmail: raw.contactEmail ? String(raw.contactEmail).trim().toLowerCase() : undefined,
          contactName: raw.contactName ? String(raw.contactName).trim().slice(0, 50) : undefined,
          contactPhone: raw.contactPhone ? String(raw.contactPhone).trim().slice(0, 30) : undefined,
          status: Number(raw.status) === 0 ? 0 : 1,
          portalType: 'hybrid' as const,
          warehouse: 'jhb1',
          permissionTemplate: 'hybrid' as const,
          username,
          temporaryPassword: password,
        }

        const existing = await this.prisma.customer.findUnique({
          where: { customerCode },
          select: { id: true },
        })
        const oms = await this.findLegacyOmsAccount(customerCode)

        if (!existing) {
          await this.provisioning.create(payload, { requirePortal: true })
          created += 1
        } else {
          const updatePayload: UpdateCustomerDto = {
            customerName: payload.customerName,
            companyName: payload.companyName,
            contactEmail: payload.contactEmail,
            contactName: payload.contactName,
            contactPhone: payload.contactPhone,
            status: payload.status,
          }
          if (!oms?.portalUserId) {
            updatePayload.portalType = payload.portalType
            updatePayload.warehouse = payload.warehouse
            updatePayload.permissionTemplate = payload.permissionTemplate
            updatePayload.username = payload.username
            updatePayload.temporaryPassword = payload.temporaryPassword
          }
          await this.provisioning.update(Number(existing.id), updatePayload)
          updated += 1
        }

        const balance = Number(raw.balance)
        if (Number.isFinite(balance) && balance < 0) {
          await this.prisma.customer.update({
            where: { customerCode },
            data: { balance },
          })
        }
      } catch (error) {
        failed += 1
        errors.push({
          customerCode,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const linkedRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(DISTINCT c.code) AS total
       FROM \`oms_CustomerAccount\` c
       INNER JOIN \`customer\` e ON e.customer_code = c.code`,
    )
    const linked = Number(linkedRows[0]?.total ?? 0)
    return {
      file: dataFile,
      total: rows.length,
      created,
      updated,
      failed,
      linked,
      errors: errors.slice(0, 30),
    }
  }

  private legacyUsername(raw: Record<string, unknown>, customerCode: string) {
    const fromFile = String(raw.username || '').trim().toLowerCase()
    if (/^[a-z0-9._-]{6,50}$/.test(fromFile)) return fromFile
    const fromCode = customerCode.trim().toLowerCase()
    if (/^[a-z0-9._-]{6,50}$/.test(fromCode)) return fromCode
    return `${fromCode}01`.replace(/[^a-z0-9._-]/g, '').slice(0, 50)
  }

  private async findLegacyOmsAccount(customerCode: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; portalUserId: string | null }>>(
      `SELECT c.id, u.id AS portalUserId
       FROM \`oms_CustomerAccount\` c
       LEFT JOIN \`oms_PortalUser\` u ON u.customerId = c.id
       WHERE c.code = ?
       LIMIT 1`,
      customerCode,
    )
    return rows[0] || null
  }

  async update(id: number, data: UpdateCustomerDto) {
    const result = await this.provisioning.update(id, data)
    return this.toProvisioningResponse(result)
  }

  async setPortalTemporaryPassword(
    id: number,
    data: SetPortalTemporaryPasswordDto,
  ) {
    const result = await this.provisioning.resetTemporaryPassword({ id: BigInt(id) }, data)
    if (!result.oms?.portalReady) {
      throw new BadRequestException('该客户尚未开通 OMS 账户')
    }
    return {
      customerCode: result.customer.customerCode,
      portalReady: true,
      portalUsername: result.oms.portalUsername || result.oms.portalLoginEmail,
      portalLoginEmail: result.oms.portalUsername || result.oms.portalLoginEmail,
      portalStatus: result.oms.portalStatus,
      mustChangePassword: result.oms.mustChangePassword,
    }
  }

  async setPortalTemporaryPasswordFromOms(
    customerCode: string,
    data: SetPortalTemporaryPasswordDto,
  ) {
    const result = await this.provisioning.resetTemporaryPassword(
      { customerCode: customerCode.trim() },
      data,
    )
    return this.toInternalProvisioningResponse(result)
  }

  /** 客户充值：增加余额并记录充值单。 */
  async recharge(id: number, data: any, operatorId?: number) {
    const customer = await this.detail(id)
    const amount = Number(data.amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('充值金额须大于 0')
    }

    let rechargeNo = String(data.rechargeNo || '').trim()
    if (!rechargeNo) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      rechargeNo = `RC-${date}-${Date.now().toString().slice(-6)}`
    }
    const duplicate = await this.prisma.customerRecharge.findUnique({
      where: { rechargeNo },
    })
    if (duplicate) throw new BadRequestException(`充值单号 ${rechargeNo} 已存在`)

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.customerRecharge.create({
        data: {
          rechargeNo,
          customerId: BigInt(id),
          amount,
          paymentMethod: data.paymentMethod || 'bank',
          status: 'confirmed',
          remark: data.remark,
          operatorId: operatorId ? BigInt(operatorId) : undefined,
        },
      })
      const updated = await tx.customer.update({
        where: { id: BigInt(id) },
        data: { balance: Number(customer.balance) + amount },
      })
      return {
        record: {
          ...record,
          id: Number(record.id),
          amount: Number(record.amount),
          rechargeNo: record.rechargeNo,
          paymentMethod: record.paymentMethod,
          status: record.status,
          createdAt: record.createdAt,
        },
        balance: Number(updated.balance),
        customerCode: customer.customerCode,
      }
    })

    void notifyOms('balance.changed', result.customerCode, {
      balance: result.balance,
      rechargeNo: result.record.rechargeNo,
      amount: result.record.amount,
      paymentMethod: result.record.paymentMethod,
    })
    return result
  }

  async rechargeHistory(id: number) {
    await this.detail(id)
    const rows = await this.prisma.customerRecharge.findMany({
      where: { customerId: BigInt(id) },
      orderBy: { id: 'desc' },
    })
    return rows.map((row) => ({
      id: Number(row.id),
      rechargeNo: row.rechargeNo,
      customerId: Number(row.customerId),
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod,
      status: row.status,
      remark: row.remark,
      createdAt: row.createdAt,
    }))
  }

  /** OMS P2：客户自助充值（即时到账）。 */
  async rechargeFromOms(customerCode: string, data: any) {
    const customer = await this.findByCodeForOms(customerCode)
    const result = await this.recharge(customer.id, {
      amount: data.amount,
      paymentMethod: data.paymentMethod || data.paymentMethodId || 'bank',
      remark: data.remark
        || `OMS 充值${data.paymentMethodTitle ? ` · ${data.paymentMethodTitle}` : ''}`,
      rechargeNo: data.rechargeNo,
    })
    return {
      ...result,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
    }
  }

  async listRechargesForOms(customerCode: string) {
    const customer = await this.findByCodeForOms(customerCode)
    const items = await this.rechargeHistory(customer.id)
    return {
      customerCode: customer.customerCode,
      balance: customer.balance,
      items,
      total: items.length,
    }
  }

  private toProvisioningResponse(result: CustomerProvisioningResult) {
    return {
      ...this.toPublicCustomer(result.customer),
      dataSource: result.oms ? ('both' as const) : ('erp' as const),
      readOnly: false,
      oms: result.oms,
    }
  }

  private toInternalProvisioningResponse(result: CustomerProvisioningResult) {
    if (!result.oms?.portalReady || !(result.oms.portalUsername || result.oms.portalLoginEmail)) {
      throw new BadRequestException('OMS 门户账户未完成开通')
    }
    const username = result.oms.portalUsername || result.oms.portalLoginEmail
    return {
      customer: this.toPublicCustomer(result.customer),
      portalAccount: {
        id: result.oms.omsId,
        customerId: result.oms.omsId,
        username,
        loginEmail: username,
        role: result.oms.type,
        // Keep compatibility aliases for older internal callers.
        code: result.customer.customerCode,
        email: username,
        type: result.oms.type,
        warehouse: result.oms.warehouse,
        status: result.oms.portalStatus || result.oms.omsStatus,
        mustChangePassword: Boolean(result.oms.mustChangePassword),
      },
    }
  }

  private toPublicCustomer(row: {
    id: bigint
    customerCode: string
    customerName: string
    companyName: string | null
    contactEmail: string | null
    contactName: string | null
    contactPhone: string | null
    balance: unknown
    status: number
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: Number(row.id),
      customerCode: row.customerCode,
      customerName: row.customerName,
      companyName: row.companyName,
      contactEmail: row.contactEmail,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      balance: Number(row.balance),
      status: row.status,
      statusLabel: row.status === 1 ? 'active' : 'disabled',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async listSkuInventory(customerId: bigint) {
    const rows = await this.prisma.customerSkuInventory.findMany({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map((row) => ({
      id: Number(row.id),
      customerId: Number(row.customerId),
      sku: row.sku,
      productName: row.productName,
      quantity: row.quantity,
      unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
      pricingId: row.pricingId ? Number(row.pricingId) : null,
      updatedAt: row.updatedAt,
    }))
  }
}
