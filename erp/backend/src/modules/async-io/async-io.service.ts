import { ForbiddenException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { AsyncIoExportService } from './async-io-export.service'
import { LeadsService } from '../leads/leads.service'
import { ProductsService } from '../products/products.service'
import { PurchaseService } from '../purchase/purchase.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { EXPORT_MODULE_PERM, exportPermForModule } from '@erp/shared/permissions.catalog'
import { userFacingError } from '@erp/shared/user-facing-error'
import { serializeImportResultDetail, type ImportRowFailure } from '../../common/import-row-result.util'
import type { AuthUser } from '../../common/decorators/current-user.decorator'
import { exportReceipt, exportScope, IMPORT_MODULE_PERM } from './async-io-scope.util'

@Injectable()
export class AsyncIoService {
  private readonly logger = new Logger(AsyncIoService.name)
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private exporter: AsyncIoExportService,
    private leadsService: LeadsService,
    private productsService: ProductsService,
    private purchaseService: PurchaseService,
    private permissions: PermissionsService,
  ) {}

  private async visibleWhere(user?: AuthUser) {
    if (!user) throw new ForbiddenException('请先登录后查看任务')
    if (user.roleCode === 'admin') return {}
    const perms = new Set(await this.permissions.getUserPermissions(user.userId, user.roleCode))
    const exports = Object.keys(EXPORT_MODULE_PERM).filter(module => perms.has(EXPORT_MODULE_PERM[module]))
    const imports = perms.has('async_io.import') ? Object.keys(IMPORT_MODULE_PERM).filter(module => perms.has(IMPORT_MODULE_PERM[module])) : []
    return { operatorId: BigInt(user.userId), OR: [
      { jobType: 'export', module: { in: exports } }, { jobType: 'import', module: { in: imports } },
    ] }
  }

  private publicJob(job: any, user?: AuthUser) {
    const receipt = job.jobType === 'export' ? exportReceipt(job.resultDetail) : null
    const { fileUrl: _fileUrl, ...rest } = job
    return { ...rest, id: Number(job.id), errorMessage: job.errorMessage ? userFacingError(job.errorMessage) : null,
      retryAttempt: receipt?.attempt ?? null, exportParams: receipt?.params ?? null,
      canRetry: job.jobType === 'export' && job.status === 'failed' && !!receipt && Number(job.operatorId) === user?.userId,
    }
  }

  async list(q: PaginationDto & { jobType?: string }, user?: AuthUser) {
    const { page, pageSize } = getPagination(q)
    if (q.jobType && !['import', 'export'].includes(q.jobType)) throw new BadRequestException('任务类型无效')
    const where = { ...await this.visibleWhere(user), ...(q.jobType ? { jobType: q.jobType } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.asyncIoJob.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.asyncIoJob.count({ where }),
    ])
    return { items: items.map(r => this.publicJob(r, user)), total, page, pageSize, scope: user?.roleCode === 'admin' ? 'all' : 'own' }
  }

  private async assertExportPerm(module: string, user?: AuthUser) {
    const perm = exportPermForModule(module)
    if (!perm) throw new BadRequestException('暂不支持该模块导出')
    if (!user || !(await this.permissions.userHasPerm(user.userId, user.roleCode, perm))) throw new ForbiddenException('没有该模块的导出权限')
  }

  async createExport(data: { module: string; fileName?: string; params?: Record<string, unknown> }, user?: AuthUser) {
    const module = String(data?.module || '').trim()
    await this.assertExportPerm(module, user)
    const { params } = exportScope(module, data.params)
    const job = await this.prisma.asyncIoJob.create({ data: {
      jobNo: 'EXP-' + randomUUID().replace(/-/g, '').slice(0, 24), jobType: 'export', module,
      fileName: `${module}.csv`, status: 'processing', operatorId: BigInt(user!.userId), startedAt: new Date(),
      resultDetail: JSON.stringify({ version: 1, kind: 'export', attempt: 1, params }),
    } })
    return this.executeExport(job, params, user!)
  }

  private async executeExport(job: any, params: Record<string, string>, user: AuthUser) {
    try {
      const result = await this.exporter.runExport(job.module, params, user)
      const fileName = `${job.jobNo}_${result.fileName}`
      const { relativePath } = this.files.write('exports', fileName, result.content)
      const updated = await this.prisma.asyncIoJob.update({ where: { id: job.id }, data: {
        fileName, fileUrl: relativePath, totalRows: result.totalRows, processedRows: result.totalRows,
        failedRows: 0, status: 'completed', errorMessage: null, finishedAt: new Date(),
      } })
      return this.publicJob(updated, user)
    } catch (error) {
      this.logger.error(`导出任务 ${job.jobNo} 执行失败`, error instanceof Error ? error.stack : String(error))
      const updated = await this.prisma.asyncIoJob.update({ where: { id: job.id }, data: {
        status: 'failed', fileUrl: null, errorMessage: userFacingError(error, undefined, '导出失败，请稍后按原筛选重试；如持续失败，请联系管理员'), finishedAt: new Date(),
      } })
      return this.publicJob(updated, user)
    }
  }

  async retryExport(id: number, expectedAttempt: unknown, user?: AuthUser) {
    const job = await this.findVisible(id, user)
    if (job.jobType !== 'export') throw new BadRequestException('导入任务不能整单重试，请仅修正失败行后重新导入')
    if (Number(job.operatorId) !== user?.userId) throw new ForbiddenException('只能重试本人创建的导出任务')
    await this.assertExportPerm(job.module, user)
    const receipt = exportReceipt(job.resultDetail)
    if (!receipt) throw new BadRequestException('旧任务未保存筛选条件，请返回原业务页面重新导出')
    if (!Number.isSafeInteger(expectedAttempt) || Number(expectedAttempt) < 1) throw new BadRequestException('请刷新任务后重试')
    if (Number(expectedAttempt) < receipt.attempt) return this.publicJob(job, user)
    if (Number(expectedAttempt) !== receipt.attempt || job.status !== 'failed') throw new ConflictException('任务状态已变化，请刷新后核对')
    const { params } = exportScope(job.module, receipt.params)
    const claimed = await this.prisma.asyncIoJob.updateMany({ where: { id: job.id, status: 'failed', resultDetail: job.resultDetail }, data: {
      status: 'processing', errorMessage: null, fileUrl: null, totalRows: 0, processedRows: 0, failedRows: 0,
      startedAt: new Date(), finishedAt: null, resultDetail: JSON.stringify({ ...receipt, attempt: receipt.attempt + 1 }),
    } })
    if (!claimed.count) return this.detail(id, user)
    return this.executeExport(job, params, user!)
  }

  async create(data: any, user?: AuthUser) {
    if (data?.jobType === 'import') return this.createImport(data, user)
    return this.createExport(data, user)
  }

  async createImport(data: { module: string; fileName?: string; content: string }, user?: AuthUser) {
    const perm = IMPORT_MODULE_PERM[String(data?.module || '')]
    if (typeof perm !== 'string') throw new BadRequestException('暂不支持该模块导入。支持：线索、商品主数据、采购订单')
    if (!user || !(await this.permissions.userHasPerm(user.userId, user.roleCode, 'async_io.import'))
      || !(await this.permissions.userHasPerm(user.userId, user.roleCode, perm))) throw new ForbiddenException('没有该模块的导入权限')
    if (typeof data.content !== 'string' || !data.content.trim()) throw new BadRequestException('请选择有内容的导入文件')
    const job = await this.prisma.asyncIoJob.create({ data: {
      jobNo: 'IMP-' + randomUUID().replace(/-/g, '').slice(0, 24), jobType: 'import', module: data.module,
      fileName: String(data.fileName || 'import.csv').slice(0, 200), status: 'processing', operatorId: BigInt(user.userId), startedAt: new Date(),
    } })
    try {
      const { ok, fail, failures } = await this.runImport(data.module, data.content, user.userId)
      const updated = await this.prisma.asyncIoJob.update({ where: { id: job.id }, data: {
        totalRows: ok + fail, processedRows: ok, failedRows: fail, status: fail > 0 && ok === 0 ? 'failed' : fail > 0 ? 'partial' : 'completed',
        resultDetail: serializeImportResultDetail(failures), finishedAt: new Date(),
      } })
      return { ...this.publicJob(updated, user), imported: ok, failed: fail, failures }
    } catch (error) {
      this.logger.error(`导入任务 ${job.jobNo} 执行失败`, error instanceof Error ? error.stack : String(error))
      await this.prisma.asyncIoJob.update({ where: { id: job.id }, data: {
        status: 'failed', errorMessage: userFacingError(error), finishedAt: new Date(),
      } })
      throw error
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

  private async findVisible(id: number, user?: AuthUser) {
    if (!Number.isSafeInteger(id) || id < 1) throw new BadRequestException('任务编号无效')
    const job = await this.prisma.asyncIoJob.findFirst({ where: { id: BigInt(id), ...await this.visibleWhere(user) } })
    if (!job) throw new NotFoundException('任务不存在或无权查看，请返回任务列表刷新')
    return job
  }

  async download(id: number, user?: AuthUser) {
    const job = await this.findVisible(id, user)
    if (job.jobType !== 'export' || job.status !== 'completed' || !job.fileUrl) throw new BadRequestException('任务尚未完成，请查看详情并刷新状态')
    await this.assertExportPerm(job.module, user)
    return { fileName: job.fileName || 'export.csv', content: this.files.read(job.fileUrl), mimeType: 'text/csv;charset=utf-8' }
  }

  async detail(id: number, user?: AuthUser) {
    return this.publicJob(await this.findVisible(id, user), user)
  }
}
