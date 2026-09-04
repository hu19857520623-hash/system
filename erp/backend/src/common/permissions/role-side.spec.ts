import {
  canUseWarehouseClient,
  catalogRoleName,
  isWarehouseStaffRole,
  roleSide,
} from '@erp/shared/permissions.catalog'

describe('role side', () => {
  it('treats 运营 / 运营主管 as office jobs', () => {
    expect(roleSide('ops')).toBe('office')
    expect(roleSide('ops_manager')).toBe('office')
    expect(catalogRoleName('ops')).toBe('运营')
    expect(catalogRoleName('ops_manager')).toBe('运营主管')
    expect(isWarehouseStaffRole('ops')).toBe(false)
    expect(isWarehouseStaffRole('ops_manager')).toBe(false)
    expect(canUseWarehouseClient('ops_manager')).toBe(false)
  })

  it('adds 采购主管 as an office job paired with 采购', () => {
    expect(roleSide('purchase_manager')).toBe('office')
    expect(catalogRoleName('purchase_manager')).toBe('采购主管')
    expect(isWarehouseStaffRole('purchase_manager')).toBe(false)
    expect(canUseWarehouseClient('purchase_manager')).toBe(false)
  })

  it('keeps specialized warehouse jobs on the warehouse side', () => {
    for (const code of ['warehouse', 'warehouse_manager', 'inbound_clerk', 'outbound_clerk', 'returns_clerk', 'warehouse_reviewer']) {
      expect(roleSide(code)).toBe('warehouse')
      expect(isWarehouseStaffRole(code)).toBe(true)
      expect(canUseWarehouseClient(code)).toBe(true)
    }
    expect(catalogRoleName('warehouse')).toBe('仓库操作')
    expect(catalogRoleName('warehouse_manager')).toBe('仓库主管')
    expect(catalogRoleName('inbound_clerk')).toBe('入库员')
    expect(catalogRoleName('outbound_clerk')).toBe('出库员')
    expect(catalogRoleName('returns_clerk')).toBe('退货员')
    expect(catalogRoleName('warehouse_reviewer')).toBe('复核员')
  })

  it('allows admin on warehouse client but not as pick staff', () => {
    expect(roleSide('admin')).toBe('system')
    expect(isWarehouseStaffRole('admin')).toBe(false)
    expect(canUseWarehouseClient('admin')).toBe(true)
  })

  it('defaults unknown jobs to office so they cannot enter warehouse surfaces', () => {
    expect(roleSide('something_new')).toBe('office')
    expect(isWarehouseStaffRole('something_new')).toBe(false)
    expect(canUseWarehouseClient('something_new')).toBe(false)
  })
})
