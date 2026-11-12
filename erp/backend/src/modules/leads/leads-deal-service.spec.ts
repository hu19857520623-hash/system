import { DEAL_SERVICES, dealServiceLabel } from '@erp/shared/deal-services'
import { resolveDealService, dealServiceWhere, dealServiceExportRows } from './leads-deal-service.util'
import { LeadsService } from './leads.service'
import { AsyncIoExportService } from '../async-io/async-io-export.service'
import { exportScope } from '../async-io/async-io-scope.util'

describe('成交服务', () => {
  it.each(['C1', 'C2'])('%s仅登记成交，不调用余额、充值或开户流程', async serviceCode => {
    const balance = { update: jest.fn() }, recharge = { create: jest.fn() }
    const customers = { create: jest.fn(), recharge: jest.fn() }
    const prisma = { customer: balance, customerRecharge: recharge, leadDeal: { create: jest.fn(async ({ data }) => ({ id: 1n, ...data })) }, lead: { update: jest.fn() } }
    const service = new LeadsService(prisma as any, {} as any, customers as any, {} as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 10 } as any)
    jest.spyOn(service as any, 'dealWithAttachments').mockResolvedValue({ id: 1 })
    await service.addDeal(10, { serviceCode, dealAmount: 100 })
    expect(prisma.leadDeal.create.mock.calls[0][0].data).toMatchObject({ serviceCode, dealAmount: 100 })
    expect(balance.update).not.toHaveBeenCalled(); expect(recharge.create).not.toHaveBeenCalled()
    expect(customers.create).not.toHaveBeenCalled(); expect(customers.recharge).not.toHaveBeenCalled()
  })
  it('没有明确OMS客户类型时拒绝开户，不从成交服务推断', async () => {
    const customers = { create: jest.fn() }
    const service = new LeadsService({} as any, {} as any, customers as any, {} as any)
    for (const value of [undefined, '', 'D1', 'G1', 'F1', '本土店']) {
      await expect(service.confirmToErp(10, { omsType: value } as any)).rejects.toThrow('请单独选择 OMS 客户类型')
    }
    expect(customers.create).not.toHaveBeenCalled()
  })
  it('19个独立代码，A5为XT回款，同名的A1和B1不合并', () => {
    expect(DEAL_SERVICES).toHaveLength(19)
    expect(new Set(DEAL_SERVICES.map(s => s.code)).size).toBe(19)
    expect(resolveDealService({ serviceCode: 'A5' }).serviceName).toContain('XT 回款')
    expect(resolveDealService({ serviceCode: 'A1' }).serviceCode).toBe('A1')
    expect(resolveDealService({ serviceCode: 'B1' }).serviceCode).toBe('B1')
  })
  it.each(DEAL_SERVICES)('$code 存储代码与名称快照，忽略客户端伪造名称', service => {
    expect(resolveDealService({ serviceCode: service.code, serviceName: '伪造名称', productDesc: '旧名称' }))
      .toEqual({ serviceCode: service.code, serviceName: service.name, productDesc: service.name })
  })
  it.each(['', null, ['A1', 'B1'], 'A1,B1', 'A7', 1])('拒绝无效或多选服务 %p', serviceCode => {
    expect(() => resolveDealService({ serviceCode })).toThrow('请选择一项有效成交服务')
  })
  it('旧记录原样显示，不根据名称推断A/B代码；旧客户端保留兼容', () => {
    expect(resolveDealService({ productDesc: '跨境店' })).toEqual({ productDesc: '跨境店' })
    expect(dealServiceLabel({ productDesc: '海外仓' })).toBe('海外仓（历史类型）')
    expect(dealServiceLabel({ serviceCode: 'A1', serviceName: '成交时的服务名' })).toBe('A1｜成交时的服务名')
  })
  it('初次与再次成交均经同一入口保存一个服务，保留金额日期备注附件', async () => {
    const prisma = { leadDeal: { create: jest.fn(async ({data}) => ({ id: 1n, ...data })) }, lead: { update: jest.fn() } }
    const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 10 } as any)
    const files = jest.spyOn(service as any, 'saveDealAttachments').mockResolvedValue(1)
    jest.spyOn(service as any, 'dealWithAttachments').mockResolvedValue({ id: 1 })
    const input = { serviceCode: 'A5', dealAmount: 100, dealDate: '2026-11-02', remark: '成交备注', attachments: [{ fileName: '资料.pdf' }] }
    await service.addDeal(10, input)
    await service.addDeal(10, { ...input, serviceCode: 'G1' })
    expect(prisma.leadDeal.create).toHaveBeenCalledTimes(2)
    expect(prisma.leadDeal.create.mock.calls[0][0].data).toMatchObject({ serviceCode: 'A5', serviceName: expect.stringContaining('XT 回款'), dealAmount: 100, dealDate: new Date('2026-11-02'), remark: '成交备注' })
    expect(prisma.leadDeal.create.mock.calls[1][0].data.serviceCode).toBe('G1')
    expect(files).toHaveBeenCalledWith(1, input.attachments)
    await expect(service.addDeal(10, {serviceCode:['A1','B1']})).rejects.toThrow()
    expect(prisma.leadDeal.create).toHaveBeenCalledTimes(2)
  })
  it('服务筛选与日期/状态落在同一成交记录，导出也只读取匹配记录', async () => {
    const prisma = { lead: {findMany: jest.fn(async (_args: any) => []),count:jest.fn(async()=>0)},sysUser:{findMany:jest.fn(async()=>[])} }
    const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
    const q = {status:'deal',serviceQuery:'A5',dealStatus:'pending',dealDateFrom:'2026-11-01'}
    await service.list(q, undefined, true)
    const args = prisma.lead.findMany.mock.calls[0][0]
    const match = { ...dealServiceWhere('A5'), status: 'pending', dealDate: {gte:new Date('2026-11-01')} }
    expect(args.where.AND).toContainEqual({deals:{some:match}})
    expect(args.include.deals.where).toEqual(match)
    await service.list(q)
    expect(prisma.lead.findMany.mock.calls[1][0].include.deals.where).toBeUndefined()
  })
  it('服务名称筛选保留历史类型，异步导出保存原筛选', () => {
    expect(dealServiceWhere('认证').OR).toContainEqual({serviceName:{contains:'认证'}})
    expect(dealServiceWhere('海外仓').OR).toContainEqual({productDesc:{contains:'海外仓'}})
    expect(exportScope('leads_deals',{serviceQuery:'A5'}).params).toEqual({serviceQuery:'A5'})
  })
  it('导出保留联系电话前导零，将备注中的公式当作文字', () => {
    const [row] = dealServiceExportRows([{leadNo:'L1',companyName:'=1+1',contactPhone:'00123',deals:[{dealNo:'D1',serviceCode:'C1',serviceName:'货盘使用押金',dealAmount:100,remark:'@SUM(1,2)'}]}])
    expect(row[1]).toBe("'=1+1");expect(row[3]).toBe("'00123");expect(row[9]).toBe('100');expect(row[10]).toBe("'@SUM(1,2)")
  })
  it('一客户多服务导出成多行，各自保留原金额和名称', async () => {
    const rows=[{leadNo:'L1',companyName:'客户',deals:[
      {dealNo:'D1',serviceCode:'A5',serviceName:'A5原始名称',dealAmount:100,dealDate:'2026-11-02',remark:'备注'},
      {dealNo:'D2',serviceCode:'G1',serviceName:'LOA 认证',dealAmount:30,dealDate:'2026-11-02'},
      {dealNo:'OLD',productDesc:'海外仓',dealAmount:null},
    ]}]
    const result=dealServiceExportRows(rows)
    expect(result.map(row=>[row[5],row[6],row[7],row[9]])).toEqual([['D1','A5','A5原始名称','100'],['D2','G1','LOA 认证','30'],['OLD','','海外仓','']])
    const leads={list:jest.fn(async()=>({items:rows}))}
    const exporter=new AsyncIoExportService({} as any,{} as any,{} as any,{} as any,leads as any)
    const csv=await exporter.runExport('leads_deals',{serviceQuery:'认证'})
    expect(csv.totalRows).toBe(3); expect(csv.content.toString()).toContain('服务代码,服务名称')
    expect(leads.list).toHaveBeenCalledWith(expect.objectContaining({serviceQuery:'认证'}),undefined,true)
  })
})
