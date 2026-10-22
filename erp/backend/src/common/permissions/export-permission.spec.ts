import { canAssignPermission, filterAssignablePerms } from '@erp/shared/permissions.catalog'

describe('导出权限只能授予对应职位', () => {
  it('销售可以导出线索，不能导出库存或财务', () => {
    expect(canAssignPermission('cs', 'leads_pool.export')).toBe(true)
    expect(canAssignPermission('cs', 'inventory_query.export')).toBe(false)
    expect(canAssignPermission('cs', 'billing.export')).toBe(false)
    expect(canAssignPermission('finance', 'billing.export')).toBe(true)
    expect(canAssignPermission('finance', 'leads_pool.export')).toBe(false)
  })

  it('系统管理员可以授予全部导出权限，保存时会丢掉不匹配的导出权限', () => {
    expect(canAssignPermission('admin', 'flow_debug.export')).toBe(true)
    expect(filterAssignablePerms('purchaser', ['purchase.view', 'purchase.export', 'billing.export'])).toEqual([
      'purchase.view',
      'purchase.export',
    ])
  })
})
