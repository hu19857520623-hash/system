import { PageHeader } from '../components/ui'
import PlatformBindingsPanel from '../components/codes/PlatformBindingsPanel'
import { useRole } from '../auth/RoleContext'

export default function Codes() {
  const { can } = useRole()

  return (
    <div className="page-shell">
      <PageHeader
        title="990码绑定"
        desc="将 Takealot 990 条码按客户对应到仓库 SKU，用于出库识别标签；货盘同一产品在不同客户下绑定的 990 互不共用"
      />
      {can('platform:read') && <PlatformBindingsPanel />}
    </div>
  )
}
