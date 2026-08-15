import { Select, MonoCode } from '../ui'
import type { DataScope } from '../../auth/useDataScope'

/** 系统管理员：列表顶部的客户筛选 */
export function AdminCustomerFilter({ scope }: { scope: DataScope }) {
  if (!scope.isAdmin) return null
  return (
    <Select
      label="客户代码"
      value={scope.customerFilter}
      onChange={scope.setCustomerFilter}
      options={[
        { value: 'all', label: '全部客户' },
        ...scope.customerOptions.map(a => ({ value: a.id, label: a.code })),
      ]}
    />
  )
}

/** 系统管理员：表格中的客户代码 */
export function AdminCustomerCell({
  customerId,
  scope,
  rowSpan,
}: {
  customerId?: string
  scope: DataScope
  rowSpan?: number
}) {
  if (!scope.isAdmin) return null
  return (
    <td
      className="table-cell align-top text-xs font-medium text-violet-700"
      rowSpan={rowSpan}
    >
      <MonoCode>{scope.getCustomerCode(customerId)}</MonoCode>
    </td>
  )
}
