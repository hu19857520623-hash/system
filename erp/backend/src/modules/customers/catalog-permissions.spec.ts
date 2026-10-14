import { OMS_PERMISSION_TEMPLATES, resolveOmsPermissions } from '@erp/shared/oms-portal.permissions'

describe('catalog account default code binding permissions', () => {
  it('allows viewing and writing platform barcode bindings without granting approval', () => {
    const permissions = resolveOmsPermissions('catalog', undefined)
    expect(permissions).toEqual(expect.arrayContaining(['platform:read', 'platform:write']))
    expect(permissions).not.toContain('code:approve')
    expect(permissions).not.toContain('account:manage')
    expect(new Set(OMS_PERMISSION_TEMPLATES.catalog).size).toBe(OMS_PERMISSION_TEMPLATES.catalog.length)
  })

  it('keeps explicitly customized permissions unchanged', () => {
    expect(resolveOmsPermissions('catalog', ['catalog:read'])).toEqual(['catalog:read'])
  })
})
