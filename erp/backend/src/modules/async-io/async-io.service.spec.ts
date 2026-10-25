import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common'
import { AsyncIoService } from './async-io.service'
import { AsyncIoExportService } from './async-io-export.service'
import { fetchOmsInventoryRows, fetchCatalogInventoryRows } from '../inventory/oms-data-bridge.util'
import { EXPORT_LEASE_MS, EXPORT_HEARTBEAT_MS, EXPORT_DEADLINE_MS, LEGACY_EXPORT_WAIT_MS } from './async-io-lease.util'
import { exportScope } from './async-io-scope.util'

const actor = { userId: 7, roleCode: 'finance', username: 'fake-finance', realName: '虚构财务' }
const admin = { ...actor, userId: 1, roleCode: 'admin' }
function fixture() {
  const jobs = new Map<bigint, any>()
  let nextId = 8n
  const matches = (job: any, where: any) => Boolean(job
    && (where.operatorId == null || where.operatorId === job.operatorId)
    && (where.status == null || where.status === job.status)
    && (where.resultDetail == null || where.resultDetail === job.resultDetail)
    && (where.executionToken === undefined || where.executionToken === job.executionToken)
    && (where.leaseUntil === undefined || (where.leaseUntil === null ? job.leaseUntil == null : job.leaseUntil && (
      where.leaseUntil.gt ? job.leaseUntil > where.leaseUntil.gt : job.leaseUntil <= where.leaseUntil.lte)))
  )
  const prisma: any = { asyncIoJob: {
    create: jest.fn(async ({ data }) => { const job = { id: nextId++, ...data }; jobs.set(job.id, job); return job }),
    update: jest.fn(async ({ where, data }) => { const job = { ...jobs.get(where.id), ...data }; jobs.set(where.id, job); return job }),
    updateMany: jest.fn(async ({ where, data }) => {
      if (!matches(jobs.get(where.id), where)) return { count: 0 }
      jobs.set(where.id, { ...jobs.get(where.id), ...data }); return { count: 1 }
    }),
    findFirst: jest.fn(async ({ where }) => matches(jobs.get(where.id), where) ? jobs.get(where.id) : null),
    findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(221),
  } }
  prisma.$transaction = jest.fn(async fn => fn(prisma))
  const files: any = { write: jest.fn().mockReturnValue({ relativePath: 'exports/fake.csv' }), read: jest.fn().mockReturnValue(Buffer.from('fake')) }
  const exporter: any = { runExport: jest.fn().mockResolvedValue({ fileName: 'fake.csv', content: 'fake', totalRows: 2 }) }
  const imports: any = { importFromCsv: jest.fn().mockResolvedValue({ imported: 1, failed: 1, failures: [{ lineNo: 3, reason: '缺少商品编号' }] }) }
  let perms = ['cost.export']
  const permissions: any = { getUserPermissions: jest.fn(async () => perms), userHasPerm: jest.fn(async (_id, role, perm) => role === 'admin' || perms.includes(perm)) }
  const service = new AsyncIoService(prisma, files, exporter, imports, imports, imports, permissions)
  return { service, prisma, files, exporter, imports, get: (id = 8n) => jobs.get(id), set: (job: any) => { jobs.set(job.id, job); if (job.id >= nextId) nextId = job.id + 1n }, perms: (next: string[]) => { perms = next } }
}
const receipt = (attempt = 1) => JSON.stringify({ version: 1, kind: 'export', attempt, params: { keyword: 'only-this', minAmount: '9' } })
const failedJob = { id: 8n, jobNo: 'EXP-fake', module: '采购货款', operatorId: 7n, jobType: 'export', status: 'failed', resultDetail: receipt() }

describe('异步任务范围、原条件重试和结果真实性', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined))
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })
  it('分页和统计在数据库使用相同权限与本人范围，通用导出权限不替代模块权限', async () => {
    const f = fixture(); f.perms(['cost.export', 'async_io.export'])
    const result = await f.service.list({ page: 2, pageSize: 20, jobType: 'export' }, actor)
    const where = f.prisma.asyncIoJob.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ operatorId: 7n, jobType: 'export' })
    expect(where.OR[0].module.in).toEqual(expect.arrayContaining(['cost', '采购货款']))
    expect(where.OR[0].module.in).not.toContain('客户结算')
    expect(f.prisma.asyncIoJob.count).toHaveBeenCalledWith({ where })
    expect(result.total).toBe(221)
  })
  it('详情、下载和重试均拒绝其他账号任务；管理员可以查看，但不能替别人重试', async () => {
    const f = fixture(); f.set({ ...failedJob, operatorId: 99n })
    await expect(f.service.detail(8, actor)).rejects.toBeInstanceOf(NotFoundException)
    await expect(f.service.download(8, actor)).rejects.toBeInstanceOf(NotFoundException)
    await expect(f.service.retryExport(8, 1, actor)).rejects.toBeInstanceOf(NotFoundException)
    expect((await f.service.detail(8, admin)).canRetry).toBe(false)
    await expect(f.service.retryExport(8, 1, admin)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.exporter.runExport).not.toHaveBeenCalled()
  })
  it('旧create入口和专用导入入口都同时要求通用导入及对应业务权限', async () => {
    const f = fixture(); const data = { jobType: 'import', module: '商品主数据', content: 'fake' }
    f.perms(['async_io.import'])
    await expect(f.service.create(data, actor)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(f.service.createImport(data, actor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.prisma.asyncIoJob.create).not.toHaveBeenCalled()
    f.perms(['async_io.import', 'products.import'])
    expect(await f.service.create(data, actor)).toMatchObject({ status: 'partial', imported: 1, failed: 1, canRetry: false })
    expect(f.imports.importFromCsv).toHaveBeenCalledWith('fake', 7)
  })
  it('创建前拒绝未知筛选或未实现模块，不生成伪完成文件', async () => {
    const f = fixture()
    await expect(f.service.createExport({ module: '采购货款', params: { unsupported: 'filter' } }, actor)).rejects.toThrow('不支持的筛选条件')
    await expect(f.service.createExport({ module: '商品主数据' }, admin)).rejects.toThrow('原业务页面导出')
    expect(f.prisma.asyncIoJob.create).not.toHaveBeenCalled()
  })
  it('失败保存原条件和中文原因，同一attempt并发/晚到重试只执行一次', async () => {
    const f = fixture(); f.exporter.runExport.mockRejectedValueOnce(new Error('EACCES synthetic private-path'))
    const failed = await f.service.createExport({ module: '采购货款', params: { keyword: 'only-this', minAmount: 9 } }, actor)
    expect(failed.status).toBe('failed'); expect(failed.errorMessage).toContain('导出失败')
    expect(failed.errorMessage).not.toContain('private-path')
    expect(failed.exportParams).toEqual({ keyword: 'only-this', minAmount: '9' })
    const [a, b] = await Promise.all([f.service.retryExport(8, 1, actor), f.service.retryExport(8, 1, actor)])
    expect([a.status, b.status]).toContain('completed')
    expect(f.exporter.runExport).toHaveBeenCalledTimes(2) // original + one retry
    expect(f.exporter.runExport).toHaveBeenLastCalledWith('采购货款', { keyword: 'only-this', minAmount: '9' }, actor)
    const late = await f.service.retryExport(8, 1, actor)
    expect(late.status).toBe('completed'); expect(late.retryAttempt).toBe(2)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(2)
  })
  it('重试本次仍失败后，旧attempt的重放不能再次执行', async () => {
    const f = fixture(); f.set(failedJob); f.exporter.runExport.mockRejectedValue(new Error('Synthetic failure'))
    await f.service.retryExport(8, 1, actor)
    await f.service.retryExport(8, 1, actor)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(1)
    await f.service.retryExport(8, 2, actor)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(2)
  })
  it('不猜测旧任务筛选，不允许整单重放部分导入；未完成即使有fileUrl也不可下载', async () => {
    const f = fixture(); f.set({ ...failedJob, resultDetail: null })
    await expect(f.service.retryExport(8, 1, actor)).rejects.toThrow('未保存筛选条件')
    f.set({ ...failedJob, status: 'processing', fileUrl: 'exports/orphan.csv' })
    await expect(f.service.download(8, actor)).rejects.toThrow('尚未完成')
    f.set({ ...failedJob, jobType: 'import', status: 'partial' })
    await expect(f.service.retryExport(8, 1, actor)).rejects.toThrow('不能整单重试')
    expect(f.files.read).not.toHaveBeenCalled()
  })
  it.each([{}, [], { range: 'week' }, { range: 'x'.repeat(1001) }])('非法筛选不会静默扩大范围 %p', input => {
    if (Object.keys(input).length === 0 && !Array.isArray(input)) expect(exportScope('获客报表', input).params).toEqual({})
    else expect(() => exportScope('获客报表', input)).toThrow()
  })
  it('导出复用各业务列表筛选及账号范围，报表使用选择的时间范围', async () => {
    const inventory: any = { query: jest.fn().mockResolvedValue({ items: [] }) }
    const cost: any = { list: jest.fn().mockResolvedValue({ items: [] }) }
    const customers: any = { list: jest.fn().mockResolvedValue({ items: [] }) }
    const leads: any = { list: jest.fn().mockResolvedValue({ items: [] }), report: jest.fn().mockResolvedValue({ bySource: [{ source: '官网', count: 4 }] }) }
    const exporter = new AsyncIoExportService({} as any, inventory, cost, customers, leads)
    await exporter.runExport('中转仓库存', { warehouseCode: 'only-one', keyword: 'fake', onlyAvailable: true }, actor)
    expect(inventory.query).toHaveBeenCalledWith({ warehouseCode: 'only-one', keyword: 'fake', onlyAvailable: 'true', warehouseType: 'logistics' }, true)
    await exporter.runExport('采购货款', { keyword: 'fake', minAmount: 9 }, actor)
    expect(cost.list).toHaveBeenCalledWith({ keyword: 'fake', minAmount: '9' }, true)
    await exporter.runExport('客户充值', { keyword: 'fake' }, actor)
    expect(customers.list).toHaveBeenCalledWith({ keyword: 'fake' }, true)
    await exporter.runExport('成交客户', { source: '官网', assigneeId: 7 }, actor)
    expect(leads.list).toHaveBeenCalledWith({ source: '官网', assigneeId: 7, status: 'deal' }, actor, true)
    expect((await exporter.runExport('获客报表', { range: 'month' }, actor)).totalRows).toBe(1)
    expect(leads.report).toHaveBeenCalledWith('month')
  })
  it('活跃执行持续续期，不能误接管；完成后清理租约和全部定时器', async () => {
    jest.useFakeTimers()
    const f = fixture(); let finish!: (value: any) => void
    f.exporter.runExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = f.service.createExport({ module: '采购货款' }, actor)
    await jest.advanceTimersByTimeAsync(0)
    const initialLease = f.get().leaseUntil.getTime()
    await jest.advanceTimersByTimeAsync(EXPORT_HEARTBEAT_MS)
    expect(f.get().leaseUntil.getTime()).toBeGreaterThan(initialLease)
    await expect(f.service.retryExport(8, 1, actor)).rejects.toThrow('仍在处理')
    expect(f.exporter.runExport).toHaveBeenCalledTimes(1)
    finish({ fileName: 'leased.csv', content: 'fake', totalRows: 1 })
    const result = await running
    expect(result).toMatchObject({ status: 'completed', leaseUntil: null, canRetry: false })
    expect(result).not.toHaveProperty('executionToken')
    expect(jest.getTimerCount()).toBe(0)
  })
  it.each(['success', 'failure'])('接管过期执行后旧执行迟到%s不能改写新任务状态或文件', async mode => {
    const f = fixture(); let finish!: (value: any) => void, fail!: (reason: Error) => void
    f.exporter.runExport.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const original = f.service.createExport({ module: '采购货款', params: { keyword: 'original-scope' } }, actor)
    await new Promise(resolve => setImmediate(resolve))
    f.set({ ...f.get(), leaseUntil: new Date(Date.now() - 1) })
    expect(await f.service.detail(8, actor)).toMatchObject({ status: 'processing', displayStatus: 'interrupted', canRetry: true })
    const replacement = await f.service.retryExport(8, 1, actor)
    expect(replacement).toMatchObject({ status: 'completed', retryAttempt: 2 })
    const state = { ...f.get() }
    if (mode === 'success') finish({ fileName: 'late-original.csv', content: 'stale', totalRows: 900 })
    else fail(new Error('late original failure'))
    await original
    expect(f.get()).toEqual(state)
    expect((await f.service.retryExport(8, 1, actor)).retryAttempt).toBe(2)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(2)
  })
  it('执行超过总时限转为中文失败，迟到导出不再发布', async () => {
    jest.useFakeTimers()
    const f = fixture(); let finish!: (value: any) => void
    f.exporter.runExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = f.service.createExport({ module: '采购货款' }, actor)
    await jest.advanceTimersByTimeAsync(EXPORT_DEADLINE_MS)
    const result = await running
    expect(result.status).toBe('failed'); expect(result.errorMessage).toContain('处理时间过长')
    expect(result.canRetry).toBe(true)
    const state = { ...f.get() }
    finish({ fileName: 'too-late.csv', content: 'late', totalRows: 999 })
    await jest.advanceTimersByTimeAsync(0)
    expect(f.get()).toEqual(state); expect(f.files.write).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
  it('心跳失败不冒充完成，租约到期才提供恢复，丢租约执行不写成功文件', async () => {
    jest.useFakeTimers()
    const f = fixture(); let finish!: (value: any) => void
    f.exporter.runExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = f.service.createExport({ module: '采购货款' }, actor)
    await jest.advanceTimersByTimeAsync(0)
    f.prisma.asyncIoJob.updateMany.mockRejectedValueOnce(new Error('Synthetic heartbeat DB failure'))
    await jest.advanceTimersByTimeAsync(EXPORT_HEARTBEAT_MS)
    finish({ fileName: 'unconfirmed.csv', content: 'fake', totalRows: 1 })
    expect((await running).canRetry).toBe(false)
    expect(f.files.write).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(EXPORT_LEASE_MS)
    expect(await f.service.detail(8, actor)).toMatchObject({ displayStatus: 'interrupted', canRetry: true })
    expect(jest.getTimerCount()).toBe(0)
  })
  it('长时间未返回的旧任务恢复为唯一关联新任务，原任务迟到完成仍保留恢复链接', async () => {
    const f = fixture(); const old = { ...failedJob, status: 'processing', executionToken: null, leaseUntil: null, startedAt: new Date(Date.now() - LEGACY_EXPORT_WAIT_MS - 1) }
    f.set(old)
    const before = await f.service.detail(8, actor)
    expect(before).toMatchObject({ canRestart: true, canRetry: false, displayStatus: 'legacy_unconfirmed' })
    const recovered = await f.service.restartLegacyExport(8, 1, actor)
    expect(recovered).toMatchObject({ id: 9, status: 'completed', exportParams: { keyword: 'only-this', minAmount: '9' } })
    f.set({ ...f.get(), status: 'completed', fileName: 'old-worker-late.csv' })
    const replay = await f.service.restartLegacyExport(8, 1, actor)
    expect(replay.id).toBe(9)
    expect(f.prisma.asyncIoJob.create).toHaveBeenCalledTimes(1)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(1)
    expect((await f.service.detail(8, actor)).replacementJobId).toBe(9)
    f.set({ ...f.get(), status: 'failed' })
    expect((await f.service.retryExport(8, 1, actor)).id).toBe(9)
    expect(f.exporter.runExport).toHaveBeenCalledTimes(1)
  })
  it('未过等待期/非本人/缺筛选的旧任务和所有导入都不能整单恢复', async () => {
    const f = fixture(); f.set({ ...failedJob, status: 'processing', startedAt: new Date() })
    await expect(f.service.restartLegacyExport(8, 1, actor)).rejects.toThrow('仍在处理')
    f.set({ ...failedJob, status: 'processing', startedAt: new Date(0), resultDetail: null })
    await expect(f.service.restartLegacyExport(8, 1, actor)).rejects.toThrow('未保存筛选')
    f.set({ ...failedJob, status: 'processing', startedAt: new Date(0), operatorId: 99n })
    await expect(f.service.restartLegacyExport(8, 1, admin)).rejects.toBeInstanceOf(ForbiddenException)
    f.set({ ...failedJob, jobType: 'import', status: 'processing' })
    await expect(f.service.restartLegacyExport(8, 1, actor)).rejects.toThrow('导入可能已部分写入')
    expect(f.exporter.runExport).not.toHaveBeenCalled()
  })
  it('导出不能把OMS读取失败当空数据，截断前达到上限也拒绝伪成功', async () => {
    const prisma: any = { $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('Synthetic OMS failure')) }
    await expect(fetchOmsInventoryRows(prisma, {}, true)).rejects.toThrow('Synthetic OMS failure')
    prisma.$queryRawUnsafe.mockResolvedValue(Array.from({ length: 5000 }, () => ({})))
    await expect(fetchOmsInventoryRows(prisma, {}, true)).rejects.toThrow('达到 5000 条')
    const holdings: any = { customerSkuInventory: { findMany: jest.fn().mockResolvedValue(Array.from({ length: 5000 }, () => ({}))) } }
    await expect(fetchCatalogInventoryRows(holdings, {}, true)).rejects.toThrow('达到 5000 条')
  })
  it('达到导出上限不静默截断', async () => {
    const prisma: any = { syncLog: { findMany: jest.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({ id: 1n, status: 'failed', createdAt: new Date(), errorMessage: 'SQLSTATE secret' }))) } }
    const exporter = new AsyncIoExportService(prisma, {} as any, {} as any, {} as any, {} as any)
    await expect(exporter.runExport('同步日志')).rejects.toThrow('超过 5000 条')
  })
})
