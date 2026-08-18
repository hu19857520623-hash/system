import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import * as path from 'path'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { parseLeadsImportCsv } from './leads-import.util'
import {
  LEAD_ASSIGNEE_ROLE_CODES,
  LEAD_SELF_ASSIGN_ROLE_CODES,
} from '@erp/shared/permissions.catalog'
import { CustomersService } from '../customers/customers.service'
import { CreateCustomerDto } from '../customers/dto/customer.dto'

const DEAL_FILE_MAX_BYTES = 10 * 1024 * 1024
const DEAL_FILE_MAX_COUNT = 30
const DEAL_FILE_EXTS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.zip',
])

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private customers: CustomersService,
  ) {}

  async list(
    q: PaginationDto & {
      status?: string
      statuses?: string
      assigneeId?: number
      source?: string
      followDue?: string
      dealStatus?: string
      shopType?: string
      dealDateFrom?: string
      dealDateTo?: string
      createdAtFrom?: string
      createdAtTo?: string
    },
  ) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    const and: any[] = []
    const statuses = String(q.statuses || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (statuses.length) where.status = { in: statuses }
    else if (q.status) where.status = q.status
    if (q.assigneeId) where.assigneeId = BigInt(q.assigneeId)
    if (q.source) where.source = q.source
    if (q.createdAtFrom || q.createdAtTo) {
      const createdAt: Record<string, Date> = {}
      if (q.createdAtFrom) createdAt.gte = new Date(q.createdAtFrom)
      if (q.createdAtTo) {
        const end = new Date(q.createdAtTo)
        end.setHours(23, 59, 59, 999)
        createdAt.lte = end
      }
      where.createdAt = createdAt
    }
    if (q.keyword) {
      and.push({
        OR: [
          { companyName: { contains: q.keyword } },
          { leadNo: { contains: q.keyword } },
          { contactName: { contains: q.keyword } },
          { contactPhone: { contains: q.keyword } },
          { deals: { some: { dealNo: { contains: q.keyword } } } },
        ],
      })
    }
    const dealWhere: Record<string, unknown> = {}
    if (q.dealStatus) dealWhere.status = q.dealStatus
    if (q.shopType) dealWhere.productDesc = q.shopType
    if (q.dealDateFrom || q.dealDateTo) {
      const dealDate: Record<string, Date> = {}
      if (q.dealDateFrom) dealDate.gte = new Date(q.dealDateFrom)
      if (q.dealDateTo) {
        const end = new Date(q.dealDateTo)
        end.setHours(23, 59, 59, 999)
        dealDate.lte = end
      }
      dealWhere.dealDate = dealDate
    }
    if (Object.keys(dealWhere).length) and.push({ deals: { some: dealWhere } })
    if (q.followDue === '1' || q.followDue === 'true') {
      and.push({
        followUps: {
          none: { nextFollowAt: { gt: new Date() } },
        },
      })
    }
    if (and.length) where.AND = and

    const includeDeals =
      q.status === 'deal' || Boolean(q.dealStatus || q.shopType || q.dealDateFrom || q.dealDateTo)
    const findArgs: Parameters<typeof this.prisma.lead.findMany>[0] = {
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { id: 'desc' },
      include: {
        followUps: { orderBy: { id: 'desc' }, take: 1 },
        ...(includeDeals
          ? {
              deals: {
                orderBy: { id: 'desc' as const },
                include: {
                  attachments: {
                    orderBy: { id: 'desc' as const },
                    select: { id: true, fileName: true, fileSize: true, createdAt: true },
                  },
                },
              },
            }
          : {}),
      },
    }

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany(findArgs),
      this.prisma.lead.count({ where }),
    ])
    const assigneeIds = [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))] as bigint[]
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as bigint[]
    const [users, customerRows] = await Promise.all([
      assigneeIds.length
        ? this.prisma.sysUser.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, realName: true, username: true },
          })
        : Promise.resolve([] as { id: bigint; realName: string | null; username: string }[]),
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, customerCode: true, customerName: true },
          })
        : Promise.resolve([] as { id: bigint; customerCode: string; customerName: string }[]),
    ])
    const nameMap = new Map<number, string>(users.map((u) => [Number(u.id), u.realName || u.username]))
    const customerMap = new Map(customerRows.map((c) => [Number(c.id), c] as const))
    const items = rows.map((r) => {
      const customer = r.customerId ? customerMap.get(Number(r.customerId)) : null
      return {
        ...r,
        assigneeName: r.assigneeId ? nameMap.get(Number(r.assigneeId)) ?? null : null,
        customerCode: customer?.customerCode ?? null,
        customerName: customer?.customerName ?? null,
      }
    })
    return { items, total, page, pageSize }
  }

  async listAssignees(currentUserId: number) {
    const [currentUser, salesUsers] = await Promise.all([
      this.prisma.sysUser.findUnique({
        where: { id: BigInt(currentUserId) },
        select: { id: true, username: true, realName: true, roleCode: true, status: true },
      }),
      this.prisma.sysUser.findMany({
        where: { status: 1, roleCode: { in: [...LEAD_ASSIGNEE_ROLE_CODES] } },
        select: { id: true, username: true, realName: true, roleCode: true },
        orderBy: { id: 'asc' },
      }),
    ])
    const items = salesUsers.map(user => ({
      id: Number(user.id),
      username: user.username,
      name: user.realName || user.username,
      roleCode: user.roleCode,
      isCurrent: Number(user.id) === currentUserId,
    }))
    if (
      currentUser?.status === 1 &&
      LEAD_SELF_ASSIGN_ROLE_CODES.includes(currentUser.roleCode as typeof LEAD_SELF_ASSIGN_ROLE_CODES[number]) &&
      !items.some(item => item.id === currentUserId)
    ) {
      items.unshift({
        id: currentUserId,
        username: currentUser.username,
        name: currentUser.realName || currentUser.username,
        roleCode: currentUser.roleCode,
        isCurrent: true,
      })
    }
    return { items, currentUserId }
  }

  async detail(id: number) {
    const row = await this.prisma.lead.findUnique({
      where: { id: BigInt(id) },
      include: {
        followUps: { orderBy: { id: 'desc' } },
        deals: {
          orderBy: { id: 'desc' },
          include: {
            attachments: {
              orderBy: { id: 'desc' },
              select: { id: true, fileName: true, fileSize: true, createdAt: true },
            },
          },
        },
      },
    })
    if (!row) throw new NotFoundException('线索不存在')
    const userIds = [
      row.assigneeId,
      ...row.followUps.map((item) => item.operatorId),
    ].filter((userId): userId is bigint => userId != null)
    const users = userIds.length
      ? await this.prisma.sysUser.findMany({
          where: { id: { in: [...new Set(userIds)] } },
          select: { id: true, username: true, realName: true },
        })
      : []
    const userNameMap = new Map(
      users.map((user) => [user.id.toString(), user.realName || user.username]),
    )
    return {
      ...row,
      assigneeName: row.assigneeId ? userNameMap.get(row.assigneeId.toString()) ?? null : null,
      followUps: row.followUps.map((item) => ({
        ...item,
        operatorName: item.operatorId
          ? userNameMap.get(item.operatorId.toString()) ?? null
          : null,
      })),
    }
  }

  async create(data: any, operatorId?: number) {
    const operator = operatorId
      ? await this.prisma.sysUser.findUnique({
          where: { id: BigInt(operatorId) },
          select: { id: true, roleCode: true, status: true },
        })
      : null
    let targetAssigneeId = data.assigneeId ? Number(data.assigneeId) : operatorId
    if (operator && LEAD_SELF_ASSIGN_ROLE_CODES.includes(operator.roleCode as typeof LEAD_SELF_ASSIGN_ROLE_CODES[number])) {
      targetAssigneeId = Number(operator.id)
    }
    if (!targetAssigneeId) throw new BadRequestException('请选择归属销售')
    const assignee = await this.prisma.sysUser.findUnique({
      where: { id: BigInt(targetAssigneeId) },
      select: { id: true, roleCode: true, status: true },
    })
    if (
      !assignee ||
      assignee.status !== 1 ||
      !LEAD_ASSIGNEE_ROLE_CODES.includes(assignee.roleCode as typeof LEAD_ASSIGNEE_ROLE_CODES[number])
    ) {
      throw new BadRequestException('归属销售无效或已停用')
    }
    return this.prisma.lead.create({
      data: {
        leadNo: data.leadNo || 'LD-' + Date.now().toString().slice(-8),
        companyName: data.companyName,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        email: data.email,
        source: data.source,
        status: data.status || 'new',
        remark: data.remark,
        assigneeId: assignee.id,
      },
    })
  }

  async update(id: number, data: any) {
    await this.detail(id)
    const { followUps: _followUps, deals: _deals, ...rest } = data
    return this.prisma.lead.update({ where: { id: BigInt(id) }, data: rest })
  }

  async addFollowUp(id: number, data: any, operatorId?: number) {
    const lead = await this.detail(id)
    const content = String(data.content || '').trim()
    if (!content) throw new BadRequestException('请填写跟进内容')
    const followType = String(data.followType || 'phone')
    if (!['phone', 'wechat', 'email', 'visit', 'other'].includes(followType)) {
      throw new BadRequestException('跟进方式无效')
    }
    const nextFollowAt = data.nextFollowAt ? new Date(data.nextFollowAt) : undefined
    if (nextFollowAt && Number.isNaN(nextFollowAt.getTime())) {
      throw new BadRequestException('下次跟进时间格式无效')
    }
    const fu = await this.prisma.leadFollowUp.create({
      data: {
        leadId: BigInt(id),
        followType,
        content,
        nextPlan: String(data.nextPlan || '').trim() || undefined,
        nextFollowAt,
        operatorId: operatorId ? BigInt(operatorId) : undefined,
      },
    })
    const patch: { status: string; assigneeId?: bigint } = { status: 'following' }
    if (operatorId && !lead.assigneeId) patch.assigneeId = BigInt(operatorId)
    await this.prisma.lead.update({ where: { id: BigInt(id) }, data: patch })
    return fu
  }

  async addDeal(id: number, data: any) {
    const lead = await this.detail(id)
    const deal = await this.prisma.leadDeal.create({
      data: {
        leadId: BigInt(id),
        dealNo: data.dealNo || 'DL-' + Date.now().toString().slice(-8),
        dealAmount: data.dealAmount,
        dealDate: data.dealDate ? new Date(data.dealDate) : new Date(),
        productDesc: data.productDesc,
        status: data.status || 'pending',
        remark: data.remark,
      },
    })
    await this.prisma.lead.update({ where: { id: BigInt(id) }, data: { status: 'deal' } })
    const files = Array.isArray(data.attachments) ? data.attachments : []
    if (files.length) {
      await this.saveDealAttachments(Number(deal.id), files)
    }
    return this.dealWithAttachments(Number(deal.id), Number(lead.id))
  }

  async confirmToErp(leadId: number, data: CreateCustomerDto) {
    const lead = await this.detail(leadId)
    const dealCount = await this.prisma.leadDeal.count({ where: { leadId: BigInt(leadId) } })
    if (!dealCount) throw new BadRequestException('没有成交记录，无法转客户')
    if (lead.customerId) {
      throw new BadRequestException('该线索已转为 ERP/OMS 客户，请勿重复开通')
    }

    const created = await this.customers.create(data, async (tx, customer) => {
      await tx.lead.update({
        where: { id: BigInt(leadId) },
        data: { customerId: customer.id, status: 'deal' },
      })
      await tx.leadDeal.updateMany({
        where: { leadId: BigInt(leadId) },
        data: { status: 'confirmed' },
      })
    })

    return {
      leadId,
      customerId: created.id,
      customerCode: created.customerCode,
      customerName: created.customerName,
      oms: created.oms,
      portalUsername: created.oms?.portalUsername || created.oms?.portalLoginEmail || data.username || data.loginEmail,
      portalLoginEmail: created.oms?.portalUsername || created.oms?.portalLoginEmail || data.username || data.loginEmail,
    }
  }

  async uploadDealAttachments(
    leadId: number,
    dealId: number,
    attachments: { fileName: string; contentBase64?: string }[],
  ) {
    await this.assertDealBelongsToLead(leadId, dealId)
    const saved = await this.saveDealAttachments(dealId, attachments || [])
    return this.dealWithAttachments(dealId, leadId, saved)
  }

  async downloadDealAttachment(leadId: number, dealId: number, attachmentId: number) {
    await this.assertDealBelongsToLead(leadId, dealId)
    const att = await this.prisma.leadDealAttachment.findFirst({
      where: { id: BigInt(attachmentId), dealId: BigInt(dealId) },
    })
    if (!att) throw new NotFoundException('客户资料不存在')
    return { fileName: att.fileName, content: this.files.read(att.filePath) }
  }

  private async assertDealBelongsToLead(leadId: number, dealId: number) {
    const deal = await this.prisma.leadDeal.findFirst({
      where: { id: BigInt(dealId), leadId: BigInt(leadId) },
    })
    if (!deal) throw new NotFoundException('成交记录不存在')
    return deal
  }

  private async dealWithAttachments(dealId: number, _leadId: number, extraSaved?: number) {
    const deal = await this.prisma.leadDeal.findUnique({
      where: { id: BigInt(dealId) },
      include: {
        attachments: {
          orderBy: { id: 'desc' },
          select: { id: true, fileName: true, fileSize: true, createdAt: true },
        },
      },
    })
    if (!deal) throw new NotFoundException('成交记录不存在')
    return {
      ...deal,
      uploadedCount: extraSaved ?? deal.attachments.length,
    }
  }

  private async saveDealAttachments(
    dealId: number,
    attachments: { fileName: string; contentBase64?: string }[],
  ) {
    const existing = await this.prisma.leadDealAttachment.count({ where: { dealId: BigInt(dealId) } })
    const incoming = attachments.filter((a) => a?.fileName && a?.contentBase64)
    if (!incoming.length) throw new BadRequestException('请选择要上传的客户资料')
    if (existing + incoming.length > DEAL_FILE_MAX_COUNT) {
      throw new BadRequestException(`每次成交最多上传 ${DEAL_FILE_MAX_COUNT} 份资料`)
    }

    let saved = 0
    for (const att of incoming) {
      const payload = String(att.contentBase64 || '')
      const raw = payload.includes(',') ? payload.slice(payload.indexOf(',') + 1) : payload
      const buf = Buffer.from(raw, 'base64')
      if (!buf.length) throw new BadRequestException(`文件 ${att.fileName} 内容为空`)
      if (buf.length > DEAL_FILE_MAX_BYTES) {
        throw new BadRequestException(`文件 ${att.fileName} 超过 10MB`)
      }
      const ext = path.extname(att.fileName || '').toLowerCase()
      if (!DEAL_FILE_EXTS.has(ext)) {
        throw new BadRequestException(`不支持的文件类型：${att.fileName}`)
      }
      const safeBase = path.basename(att.fileName).replace(/[^\w.\u4e00-\u9fa5-]/g, '_')
      const storedName = `${dealId}_${Date.now()}_${saved}_${safeBase}`
      const written = this.files.write('lead-deal-docs', storedName, buf)
      await this.prisma.leadDealAttachment.create({
        data: {
          dealId: BigInt(dealId),
          fileName: path.basename(att.fileName).slice(0, 200),
          filePath: written.relativePath,
          fileSize: buf.length,
        },
      })
      saved += 1
    }
    return saved
  }

  async remove(id: number) {
    await this.detail(id)
    await this.prisma.leadFollowUp.deleteMany({ where: { leadId: BigInt(id) } })
    await this.prisma.leadDealAttachment.deleteMany({ where: { deal: { leadId: BigInt(id) } } })
    await this.prisma.leadDeal.deleteMany({ where: { leadId: BigInt(id) } })
    await this.prisma.lead.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  async importFromCsv(content: string, defaultAssigneeId?: number) {
    let parsed: ReturnType<typeof parseLeadsImportCsv>
    try {
      parsed = parseLeadsImportCsv(content)
    } catch (e: any) {
      throw new NotFoundException(e.message || '导入文件格式错误')
    }
    if (!parsed.length) throw new NotFoundException('文件为空或没有有效数据行')

    const salesUsers = await this.prisma.sysUser.findMany({
      where: { status: 1, roleCode: { in: [...LEAD_ASSIGNEE_ROLE_CODES] } },
      select: { id: true, username: true, realName: true },
    })
    const assigneeByKey = new Map<string, bigint>()
    for (const u of salesUsers) {
      assigneeByKey.set(u.username.toLowerCase(), u.id)
      if (u.realName) assigneeByKey.set(u.realName.toLowerCase(), u.id)
    }

    let ok = 0
    let fail = 0
    for (const row of parsed) {
      try {
        let assigneeId: bigint | undefined
        if (row.assigneeKey) {
          assigneeId = assigneeByKey.get(row.assigneeKey.toLowerCase())
          if (!assigneeId) {
            fail++
            continue
          }
        } else if (defaultAssigneeId) {
          assigneeId = BigInt(defaultAssigneeId)
        } else {
          fail++
          continue
        }
        await this.create({
          leadNo: row.leadNo,
          companyName: row.companyName,
          contactName: row.contactName,
          contactPhone: row.contactPhone,
          source: row.source,
          remark: row.remark,
          assigneeId: Number(assigneeId),
        })
        ok++
      } catch {
        fail++
      }
    }
    return { imported: ok, failed: fail }
  }

  /** 获客报表汇总 */
  async report(range?: string) {
    const createdAt = this.reportCreatedAtFilter(range)
    const where = createdAt ? { createdAt } : {}
    const [total, following, deal, lost, thisMonthNew, leads, bySource] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { ...where, status: 'following' } }),
      this.prisma.lead.count({ where: { ...where, status: 'deal' } }),
      this.prisma.lead.count({ where: { ...where, status: 'lost' } }),
      this.prisma.lead.count({ where: { createdAt: this.reportCreatedAtFilter('month') } }),
      this.prisma.lead.findMany({
        where,
        select: { assigneeId: true, status: true, createdAt: true },
      }),
      this.prisma.lead.groupBy({ by: ['source'], where, _count: { _all: true } }),
    ])
    const assigneeIds = [...new Set(leads.map((l) => l.assigneeId).filter(Boolean))] as bigint[]
    const users = assigneeIds.length
      ? await this.prisma.sysUser.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, realName: true, username: true },
        })
      : []
    const nameMap = new Map(users.map((u) => [Number(u.id), u.realName || u.username]))
    const salesMap = new Map<number, { name: string; total: number; following: number; won: number }>()
    for (const lead of leads) {
      const id = lead.assigneeId ? Number(lead.assigneeId) : 0
      const row = salesMap.get(id) || {
        name: id ? nameMap.get(id) || '未分配' : '未分配',
        total: 0,
        following: 0,
        won: 0,
      }
      row.total += 1
      if (lead.status === 'following') row.following += 1
      if (lead.status === 'deal') row.won += 1
      salesMap.set(id, row)
    }
    const monthlyMap = new Map<string, { count: number; won: number }>()
    for (const lead of leads) {
      const key = `${lead.createdAt.getFullYear()}-${String(lead.createdAt.getMonth() + 1).padStart(2, '0')}`
      const row = monthlyMap.get(key) || { count: 0, won: 0 }
      row.count += 1
      if (lead.status === 'deal') row.won += 1
      monthlyMap.set(key, row)
    }
    const monthly = [...monthlyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, row]) => ({ month, ...row }))
    const salesRank = [...salesMap.values()]
      .map((row) => ({
        ...row,
        rate: row.total ? Number(((row.won / row.total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.won - a.won || b.total - a.total)
    return {
      total,
      following,
      deal,
      lost,
      thisMonthNew,
      conversionRate: total ? Number(((deal / total) * 100).toFixed(1)) : 0,
      bySource: bySource.map((s) => ({ source: s.source || '其他', count: s._count._all })),
      monthly,
      salesRank,
    }
  }

  private reportCreatedAtFilter(range?: string): { gte: Date } | undefined {
    const now = new Date()
    if (range === 'month') return { gte: new Date(now.getFullYear(), now.getMonth(), 1) }
    if (range === 'quarter') {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
      return { gte: new Date(now.getFullYear(), quarterStartMonth, 1) }
    }
    return undefined
  }
}
