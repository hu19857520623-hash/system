import 'reflect-metadata'
import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { canAssignPermission, defaultPermsForRoleCode, filterAssignablePerms, ROLE_DEFINITIONS } from '@erp/shared/permissions.catalog'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { PERMS_KEY } from '../../common/decorators/require-perms.decorator'
import { InventoryController } from './inventory.controller'

const permission = 'inventory_query.reclaim_refund'
const endpoints = ['previewCatalogReclaim', 'reclaimCatalogHolding', 'catalogReclaimHistory', 'retryCatalogReclaimSync'] as const

function context(method: typeof endpoints[number], roleCode: string): ExecutionContext {
  return {
    getHandler: () => InventoryController.prototype[method],
    getClass: () => InventoryController,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 123, roleCode } }) }),
  } as unknown as ExecutionContext
}

describe('货盘收回退款岗位边界', () => {
  it('财务有核对持有和原购买单所需的查看权限，但没有库存调整权限', () => {
    const finance = defaultPermsForRoleCode('finance')
    expect(finance).toEqual(expect.arrayContaining(['pricing.view', 'inventory_query.view', 'inventory_query.detail', permission]))
    expect(finance).not.toContain('inventory_query.adjust')
  })

  it.each(ROLE_DEFINITIONS.map(r => r.roleCode))('只允许财务和系统管理员配置退款权限：%s', roleCode => {
    const allowed = ['admin', 'finance'].includes(roleCode)
    expect(canAssignPermission(roleCode, permission)).toBe(allowed)
    expect(filterAssignablePerms(roleCode, [permission])).toEqual(allowed ? [permission] : [])
    expect(defaultPermsForRoleCode(roleCode).includes(permission)).toBe(allowed)
  })

  describe.each(endpoints)('%s', method => {
    it('接口要求独立退款权限，不沿用库存调整权限', () => {
      expect(Reflect.getMetadata(PERMS_KEY, InventoryController.prototype[method])).toEqual([permission])
    })

    it.each(['viewer', 'dev_manager', 'warehouse_manager', 'ops_manager', 'purchaser'])('即使误配置权限也拒绝其他岗位：%s', roleCode => {
      expect(() => new RolesGuard(new Reflector()).canActivate(context(method, roleCode))).toThrow(ForbiddenException)
    })

    it.each(['admin', 'finance'])('允许指定岗位通过岗位检查：%s', roleCode => {
      expect(new RolesGuard(new Reflector()).canActivate(context(method, roleCode))).toBe(true)
    })

    it('财务单独撤销退款权限后仍不能执行', async () => {
      const permissions = { userHasAllPerms: jest.fn().mockResolvedValue(false) }
      const guard = new PermissionsGuard(new Reflector(), permissions as unknown as PermissionsService)
      await expect(guard.canActivate(context(method, 'finance'))).rejects.toThrow(ForbiddenException)
      expect(permissions.userHasAllPerms).toHaveBeenCalledWith(123, 'finance', [permission])
    })
  })
})
