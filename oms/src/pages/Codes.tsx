import { PageHeader } from '../components/ui'
import PlatformBindingsPanel from '../components/codes/PlatformBindingsPanel'
import { useRole } from '../auth/RoleContext'

export default function Codes() {
  const { can } = useRole()

  return (
    <div className="page-shell">
      <PageHeader
        title="990码绑定"
        desc="将 Takealot 990 条码对应到仓库 SKU，用于出库识别标签；不会从平台拉单扣库存"
      />
      {can('platform:read') && <PlatformBindingsPanel />}
    </div>
  )
}
