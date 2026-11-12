import 'reflect-metadata'
import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { LeadsController } from './leads.controller'

describe('线索接口权限延续', () => {
  function setup(method: 'list' | 'detail' | 'update' | 'addFollowUp' | 'updateFollowUp', granted: string[]) {
    const permissions = {
      userHasAllPerms: jest.fn(async (_id, _role, required: string[]) => required.every(p => granted.includes(p))),
      userHasAnyPerm: jest.fn(async (_id, _role, required: string[]) => required.some(p => granted.includes(p))),
    }
    const guard = new PermissionsGuard(new Reflector(), permissions as any)
    const context = {
      getHandler: () => LeadsController.prototype[method],
      getClass: () => LeadsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: 2, roleCode: 'cs' } }) }),
    } as unknown as ExecutionContext
    return { guard, context }
  }

  it.each(['list', 'detail'] as const)('%s 沿用现有查看权限', async method => {
    for (const perm of ['leads_pool.view', 'leads_follow.view', 'leads_deals.view']) {
      const { guard, context } = setup(method, [perm])
      await expect(guard.canActivate(context)).resolves.toBe(true)
    }
    const { guard, context } = setup(method, [])
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it.each(['update', 'addFollowUp', 'updateFollowUp'] as const)('%s 仅有查看权限不能写入', async method => {
    const denied = setup(method, ['leads_follow.view'])
    await expect(denied.guard.canActivate(denied.context)).rejects.toBeInstanceOf(ForbiddenException)
    const allowed = setup(method, ['leads_follow.edit'])
    await expect(allowed.guard.canActivate(allowed.context)).resolves.toBe(true)
  })
})
