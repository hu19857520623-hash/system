import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { AsyncIoExportService } from './async-io-export.service'
import { LeadsService } from '../leads/leads.service'
import { ProductsService } from '../products/products.service'

@Injectable()
export class AsyncIoService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private exporter: AsyncIoExportService,
    private leadsService: LeadsService,
    private productsService: ProductsService,
  ) {}

  async list(q: PaginationDto & { jobType?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.jobType) where.jobType = q.jobType
    const [items, total] = await Promise.all([
      this.prisma.asyncIoJob.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.asyncIoJob.count({ where }),
    ])
    return {
      items: items.map((r) => ({ ...r, id: Number(r.id) })),
      total,
      page,
      pageSize,
    }
  }

  /** 创建并立即执行导出任务 */
  async createExport(data: { module: string; fileName?: string; params?: Record<string, unknown> }, operatorId?: number) {
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
  async create(data: any, operatorId?: number) {
    if (data.jobType === 'import') {
      return this.createImport(data, operatorId)
    }
    return this.createExport({ module: data.module, fileName: data.fileName, params: data.params }, operatorId)
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
      const { ok, fail } = await this.runImport(data.module, data.content, operatorId)
      const updated = await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: {
          totalRows: ok + fail,
          processedRows: ok,
          failedRows: fail,
          status: fail > 0 && ok === 0 ? 'failed' : fail > 0 ? 'partial' : 'completed',
          finishedAt: new Date(),
        },
      })
      return { ...updated, id: Number(updated.id), imported: ok, failed: fail }
    } catch (e: any) {
      await this.prisma.asyncIoJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMessage: e.message, finishedAt: new Date() },
      })
      throw e
    }
  }

  private async runImport(module: string, content: string, operatorId?: number) {
    if (module === '线索' || module === 'leads') {
      const result = await this.leadsService.importFromCsv(content, operatorId)
      return { ok: result.imported, fail: result.failed }
    }
    if (module === '商品主数据' || module === 'products') {
      const result = await this.productsService.importFromCsv(content, operatorId)
      return { ok: result.imported, fail: result.failed }
    }

    throw new BadRequestException(
      '暂不支持该模块导入。支持：线索、商品主数据',
    )
  }

  async download(id: number) {
    const job = await this.prisma.asyncIoJob.findUnique({ where: { id: BigInt(id) } })
    if (!job?.fileUrl) throw new NotFoundException('文件不存在或任务未完成')
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
