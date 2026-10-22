import { ForbiddenException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { AsyncIoExportService } from './async-io-export.service'
import { LeadsService } from '../leads/leads.service'
import { ProductsService } from '../products/products.service'
import { PurchaseService } from '../purchase/purchase.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { exportPermForModule } from '../../common/permissions/permissions.constants'
import { serializeImportResultDetail, type ImportRowFailure } from '../../common/import-row-result.util'

@Injectable()
export class AsyncIoService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private exporter: AsyncIoExportService,
    private leadsService: LeadsService,
    private productsService: ProductsService,
    private purchaseService: PurchaseService,
    private permissions: PermissionsService,
  ) {}

  async list(q: PaginationDto & { jobType?: string }, user?: { userId: number; roleCode: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.jobType) where.jobType = q.jobType
    const [items, total] = await Promise.all([
      this.prisma.asyncIoJob.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.asyncIoJob.count({ where }),
    ])
    const visible = user ? await this.filterVisibleJobs(items, user) : items
    return {
      items: visible.map((r) => ({ ...r, id: Number(r.id) })),
      total: user ? visible.length : total,
      page,
      pageSize,
    }
  }

  private async filterVisibleJobs<T extends { jobType: string; module: string }>(
    items: T[],
    user: { userId: number; roleCode: string },
  ) {
    if (user.roleCode === 'admin') return items
    const perms = new Set(await this.permissions.getUserPermissions(user.userId, user.roleCode))
    const seesAllExports = perms.has('async_io.export')
    const seesImports = perms.has('async_io.import')
    return items.filter((job) => {
      if (job.jobType !== 'export') return seesImports
      if (seesAllExports) return true
      const perm = exportPermForModule(job.module)
      return Boolean(perm && perms.has(perm))
    })
  }

  private async assertExportPerm(module: string, user?: { userId: number; roleCode: string }) {
    const perm = exportPermForModule(module)
    if (!perm) throw new BadRequestException('暂不支持该模块导出')
    if (!user) throw new ForbiddenException('没有该模块的导出权限')
    if (!(await this.permissions.userHasPerm(user.userId, user.roleCode, perm))) {
      throw new ForbiddenException('没有该模块的导出权限')
    }
  }

  /** 创建并立即执行导出任务 */
  async createExport(data: { module: string; fileName?: string; params?: Record<string, unknown> }, user?: { userId: number; roleCode: string }) {
    await this.assertExportPerm(data.module, user)
    const operatorId = user?.userId
    const job = await this.prisma.asyncIoJob.create({
      data: {
        jobNo: 'EXP-' + Date.now().toString().slice(-8),
        jobType: 'export',
        module: data.module,
        fileName: data.fileName || `${data.module}.csv`,
        status: 'processing',
        operatorId: operatorId ? BigInt(operatorId) : undefined,
        startedAt: new Date(),
      },
    })
    try {
      const result = await this.exporter.runExport(data.module, data.params)
      const { relativePath } = this.files.write('exports', result.fileName, result.content)
      const updated = await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: {
          fileName: result.fileName,
          fileUrl: relativePath,
          totalRows: result.totalRows,
          processedRows: result.totalRows,
          failedRows: 0,
          status: 'completed',
          finishedAt: new Date(),
        },
      })
      return { ...updated, id: Number(updated.id) }
    } catch (e: any) {
      await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: e.message, finishedAt: new Date() },
      })
      throw e
    }
  }

  /** 兼容旧 create 接口 */
  async create(data: any, user?: { userId: number; roleCode: string }) {
    if (data.jobType === 'import') {
      return this.createImport(data, user?.userId)
    }
    return this.createExport({ module: data.module, fileName: data.fileName, params: data.params }, user)
  }

  async createImport(data: { module: string; fileName?: string; content: string }, operatorId?: number) {
    const job = await this.prisma.asyncIoJob.create({
      data: {
        jobNo: 'IMP-' + Date.now().toString().slice(-8),
        jobType: 'import',
        module: data.module,
        fileName: data.fileName || 'import.csv',
        status: 'processing',
        operatorId: operatorId ? BigInt(operatorId) : undefined,
        startedAt: new Date(),
      },
    })
    try {
      const { ok, fail, failures } = await this.runImport(data.module, data.content, operatorId)
      const resultDetail = serializeImportResultDetail(failures)
      const updated = await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: {
          totalRows: ok + fail,
          processedRows: ok,
          failedRows: fail,
          status: fail > 0 && ok === 0 ? 'failed' : fail > 0 ? 'partial' : 'completed',
          resultDetail,
          finishedAt: new Date(),
        },
      })
      return {
        ...updated,
        id: Number(updated.id),
        imported: ok,
        failed: fail,
        failures,
      }
    } catch (e: any) {
      await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: e.message, finishedAt: new Date() },
      })
      throw e
    }
  }

  private async runImport(
    module: string,
    content: string,
    operatorId?: number,
  ): Promise<{ ok: number; fail: number; failures: ImportRowFailure[] }> {
    if (module === '线索' || module === 'leads') {
      const result = await this.leadsService.importFromCsv(content, operatorId)
      return { ok: result.imported, fail: result.failed, failures: result.failures ?? [] }
    }
    if (module === '商品主数据' || module === 'products') {
      const result = await this.productsService.importFromCsv(content, operatorId)
      return { ok: result.imported, fail: result.failed, failures: result.failures ?? [] }
    }
    if (module === '采购订单' || module === 'purchase-orders') {
      const result = await this.purchaseService.importFromCsv(content, operatorId)
      return { ok: result.imported, fail: result.failed, failures: result.failures ?? [] }
    }

    throw new BadRequestException(
      '暂不支持该模块导入。支持：线索、商品主数据、采购订单',
    )
  }

  async download(id: number, user?: { userId: number; roleCode: string }) {
    const job = await this.prisma.asyncIoJob.findUnique({ where: { id: BigInt(id) } })
    if (!job?.fileUrl) throw new NotFoundException('文件不存在或任务未完成')
    if (job.jobType === 'export') await this.assertExportPerm(job.module, user)
    const buf = this.files.read(job.fileUrl)
    return {
      fileName: job.fileName || 'export.csv',
      content: buf,
      mimeType: 'text/csv;charset=utf-8',
    }
  }

  async detail(id: number) {
    const job = await this.prisma.asyncIoJob.findUnique({ where: { id: BigInt(id) } })
    if (!job) throw new NotFoundException('任务不存在')
    return { ...job, id: Number(job.id) }
  }
}
