import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CreateOperatingLedgerDto, UpdateOperatingLedgerDto } from './dto/operating-ledger.dto'
import { parseOperatingLedgerImportCsv, type OperatingLedgerImportError } from './operating-ledger-import.util'

export type OperatingLedgerQuery = {
  page?: string | number
  pageSize?: string | number
  keyword?: string
  direction?: string
  category?: string
  currency?: string
  startDate?: string
  endDate?: string
}

@Injectable()
export class OperatingLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: OperatingLedgerQuery) {
    const page = this.positiveInt(query.page, 1)
    const pageSize = Math.min(this.positiveInt(query.pageSize, 20), 200)
    const where = this.buildWhere(query)
    const incomeWhere: Prisma.OperatingLedgerWhereInput = { AND: [where, { direction: 'income' }] }
    const expenseWhere: Prisma.OperatingLedgerWhereInput = { AND: [where, { direction: 'expense' }] }

    const [items, total, income, expense] = await Promise.all([
      this.prisma.operatingLedger.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.operatingLedger.count({ where }),
      this.prisma.operatingLedger.aggregate({ where: incomeWhere, _sum: { amount: true }, _count: true }),
      this.prisma.operatingLedger.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: true }),
    ])

    const totalIncome = Number(income._sum.amount || 0)
    const totalExpense = Number(expense._sum.amount || 0)
    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        totalIncome: this.money(totalIncome),
        totalExpense: this.money(totalExpense),
        netAmount: this.money(totalIncome - totalExpense),
        incomeCount: income._count,
        expenseCount: expense._count,
      },
    }
  }

  create(data: CreateOperatingLedgerDto, createdBy?: number) {
    return this.prisma.operatingLedger.create({
      data: {
        entryNo: this.entryNo(),
        direction: data.direction,
        category: data.category.trim(),
        amount: data.amount,
        currency: this.currency(data.currency),
        paymentMethod: this.optional(data.paymentMethod),
        accountName: this.optional(data.accountName),
        counterparty: this.optional(data.counterparty),
        referenceNo: this.optional(data.referenceNo),
        occurredOn: this.parseDate(data.occurredOn),
        remark: this.optional(data.remark),
        createdBy: createdBy ? BigInt(createdBy) : undefined,
      },
    })
  }

  async importCsv(content: string, createdBy?: number) {
    if (!content.trim()) throw new BadRequestException('导入文件内容为空')
    const parsed = parseOperatingLedgerImportCsv(content)
    const errors: OperatingLedgerImportError[] = [...parsed.errors]
    const accepted: Prisma.OperatingLedgerCreateManyInput[] = []
    const seenEntryNos = new Set<string>()
    const suppliedEntryNos = parsed.rows.map((row) => row.entryNo).filter(Boolean) as string[]
    const existing = suppliedEntryNos.length
      ? await this.prisma.operatingLedger.findMany({
          where: { entryNo: { in: suppliedEntryNos } },
          select: { entryNo: true },
        })
      : []
    const existingSet = new Set(existing.map((row) => row.entryNo))

    for (const row of parsed.rows) {
      const entryNo = row.entryNo || this.entryNo(row.line)
      if (seenEntryNos.has(entryNo) || existingSet.has(entryNo)) {
        errors.push({ line: row.line, message: `流水号重复：${entryNo}` })
        continue
      }
      try {
        accepted.push({
          entryNo,
          direction: row.direction,
          category: row.category,
          amount: row.amount,
          currency: this.currency(row.currency),
          paymentMethod: this.optional(row.paymentMethod),
          accountName: this.optional(row.accountName),
          counterparty: this.optional(row.counterparty),
          referenceNo: this.optional(row.referenceNo),
          occurredOn: this.parseDate(row.occurredOn),
          remark: this.optional(row.remark),
          createdBy: createdBy ? BigInt(createdBy) : null,
        })
        seenEntryNos.add(entryNo)
      } catch (error) {
        errors.push({ line: row.line, message: error instanceof Error ? error.message : '数据无效' })
      }
    }
    if (accepted.length) await this.prisma.operatingLedger.createMany({ data: accepted })
    return { imported: accepted.length, failed: errors.length, errors }
  }

  async update(id: number, data: UpdateOperatingLedgerDto) {
    await this.requireEntry(id)
    return this.prisma.operatingLedger.update({
      where: { id: BigInt(id) },
      data: {
        ...(data.direction ? { direction: data.direction } : {}),
        ...(data.category != null ? { category: data.category.trim() } : {}),
        ...(data.amount != null ? { amount: data.amount } : {}),
        ...(data.currency != null ? { currency: this.currency(data.currency) } : {}),
        ...(data.paymentMethod !== undefined ? { paymentMethod: this.optional(data.paymentMethod) } : {}),
        ...(data.accountName !== undefined ? { accountName: this.optional(data.accountName) } : {}),
        ...(data.counterparty !== undefined ? { counterparty: this.optional(data.counterparty) } : {}),
        ...(data.referenceNo !== undefined ? { referenceNo: this.optional(data.referenceNo) } : {}),
        ...(data.occurredOn ? { occurredOn: this.parseDate(data.occurredOn) } : {}),
        ...(data.remark !== undefined ? { remark: this.optional(data.remark) } : {}),
      },
    })
  }

  async remove(id: number) {
    await this.requireEntry(id)
    await this.prisma.operatingLedger.delete({ where: { id: BigInt(id) } })
    return { success: true }
  }

  private buildWhere(query: OperatingLedgerQuery): Prisma.OperatingLedgerWhereInput {
    const where: Prisma.OperatingLedgerWhereInput = {}
    if (query.direction && ['income', 'expense'].includes(query.direction)) where.direction = query.direction
    if (query.category?.trim()) where.category = query.category.trim()
    if (query.currency?.trim()) where.currency = query.currency.trim().toUpperCase()
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim()
      where.OR = [
        { entryNo: { contains: keyword } },
        { category: { contains: keyword } },
        { counterparty: { contains: keyword } },
        { referenceNo: { contains: keyword } },
        { remark: { contains: keyword } },
      ]
    }
    const start = query.startDate ? this.parseDate(query.startDate) : null
    const end = query.endDate ? this.parseDate(query.endDate, true) : null
    if (start || end) {
      where.occurredOn = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
      }
    }
    return where
  }

  private async requireEntry(id: number) {
    const entry = await this.prisma.operatingLedger.findUnique({ where: { id: BigInt(id) } })
    if (!entry) throw new NotFoundException('收支记录不存在')
    return entry
  }

  private parseDate(value: string, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
      throw new BadRequestException('日期格式必须为 YYYY-MM-DD')
    }
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new BadRequestException('日期无效')
    }
    return date
  }

  private entryNo(sequence = 0) {
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const suffix = `${Date.now().toString().slice(-5)}${String(sequence % 1000).padStart(3, '0')}`
    return `JYSZ-${date}-${suffix}`
  }

  private currency(value?: string) {
    return String(value || 'CNY').trim().toUpperCase().slice(0, 10) || 'CNY'
  }

  private optional(value?: string) {
    const text = String(value || '').trim()
    return text || null
  }

  private positiveInt(value: string | number | undefined, fallback: number) {
    const number = Number(value)
    return Number.isInteger(number) && number > 0 ? number : fallback
  }

  private money(value: number) {
    return Math.round(value * 100) / 100
  }
}
