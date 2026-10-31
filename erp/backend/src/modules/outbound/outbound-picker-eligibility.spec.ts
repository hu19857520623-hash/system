import { OutboundService } from './outbound.service'

function fixture() {
  const users: any[] = [
    { id: 59n, username: 'picker', roleCode: 'outbound_clerk', status: 1, realName: '拣货员', workstation: 'A' },
    { id: 61n, username: 'reviewer', roleCode: 'warehouse_reviewer', status: 1 },
    { id: 62n, username: 'finance', roleCode: 'finance', status: 1 },
  ]
  const prisma: any = {
    sysUser: { findMany: jest.fn(async () => users), findUnique: jest.fn(async ({ where }: any) => users.find(u => u.id === where.id)) },
    sysUserPermission: { findMany: jest.fn(async ({ where }: any) => where.userId === 59n ? [{ permCode: 'outbound.pick' }] : []) },
    sysRolePermission: { findMany: jest.fn(async ({ where }: any) => where.roleCode === 'warehouse_reviewer' ? [{ permCode: 'outbound.pack' }] : []) },
    outboundOrder: { findMany: jest.fn(async () => [{ id: 62n, status: 'pending_pick', outboundNo: 'OB-62' }]), updateMany: jest.fn(async () => ({ count: 1 })) },
  }
  const service = new OutboundService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any)
  return { service, prisma, users }
}
describe('按实际权限选择拣货员', () => {
  it('普通出库接口只返回启用仓库人员中实际具有拣货权限者及必要字段', async () => {
    const f = fixture()
    await expect(f.service.pickers()).resolves.toEqual({ items: [{ id: 59, name: '拣货员', workstation: 'A' }], total: 1 })
    expect(f.prisma.sysUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 1 } }))
    expect(f.prisma.sysUser.findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })
  it('有自定义权限时以自定义为准，不因仓库角色默认权限而显示', async () => {
    const f = fixture();f.prisma.sysUserPermission.findMany.mockResolvedValue([{ permCode: 'outbound.view' }])
    await expect(f.service.pickers()).resolves.toEqual({ items: [], total: 0 })
    await expect(f.service.assignPicker([62], 59)).rejects.toThrow('没有拣货权限')
    expect(f.prisma.outboundOrder.updateMany).not.toHaveBeenCalled()
  })
  it('角色授予拣货权限后可选，移除后即使持有旧名单也不能分配', async () => {
    const f = fixture();f.prisma.sysRolePermission.findMany.mockResolvedValue([{ permCode: 'outbound.pick' }])
    expect((await f.service.pickers()).items.map(u => u.id)).toEqual([59, 61])
    await expect(f.service.assignPicker([62], 61)).resolves.toMatchObject({ pickerId: 61 })
    f.prisma.sysRolePermission.findMany.mockResolvedValue([{ permCode: 'outbound.pack' }])
    await expect(f.service.assignPicker([62], 61)).rejects.toThrow('没有拣货权限')
    expect(f.prisma.outboundOrder.updateMany).toHaveBeenCalledTimes(1)
  })
  it('停用或办公人员不能被绕过候选名单直接分配', async () => {
    const f = fixture();f.users[0].status = 0
    await expect(f.service.assignPicker([62], 59)).rejects.toThrow('已停用')
    await expect(f.service.assignPicker([62], 62)).rejects.toThrow('仓储职位')
    expect(f.prisma.outboundOrder.updateMany).not.toHaveBeenCalled()
  })
  it('权限读取故障不返回部分候选名单', async () => {
    const f = fixture();f.prisma.sysUserPermission.findMany.mockRejectedValue(new Error('权限暂时无法核对'))
    await expect(f.service.pickers()).rejects.toThrow('权限暂时无法核对')
  })
})
