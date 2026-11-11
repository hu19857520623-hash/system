import { OperationLogService } from './operation-log.service'

describe('operation audit transaction routing', () => {
  const request = { operatorId: 7, module: 'inventory', action: 'add_location', targetId: 'SKU-A' }
  function client() { return { sysUser: { findUnique: jest.fn().mockResolvedValue({ realName: '仓库员' }) }, operationLog: { create: jest.fn().mockResolvedValue({ id: 1n }) } } }
  it('uses the supplied transaction for both actor lookup and required audit persistence', async () => {
    const root = client(), tx = client(), service = new OperationLogService(root as any)
    await service.log(request, tx as any)
    expect(root.sysUser.findUnique).not.toHaveBeenCalled()
    expect(root.operationLog.create).not.toHaveBeenCalled()
    expect(tx.operationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ operatorId: 7n, operatorName: '仓库员', action: 'add_location' }) })
  })
  it('propagates audit failure so the caller transaction can roll back', async () => {
    const root = client(), tx = client(), service = new OperationLogService(root as any)
    tx.operationLog.create.mockRejectedValueOnce(new Error('audit write failed'))
    await expect(service.log(request, tx as any)).rejects.toThrow('audit write failed')
    expect(root.operationLog.create).not.toHaveBeenCalled()
  })
  it('keeps existing standalone callers on the default client', async () => {
    const root = client(), service = new OperationLogService(root as any)
    await service.log(request)
    expect(root.operationLog.create).toHaveBeenCalledTimes(1)
  })
})
