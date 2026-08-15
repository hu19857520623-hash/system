import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../components/ui'
import PlatformBindingsPanel from '../components/codes/PlatformBindingsPanel'
import AuxiliaryCodesPanel from '../components/codes/AuxiliaryCodesPanel'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { bindingTabCounts } from '../data/platformBindingUtils'
import { usePlatformSkuMappings, useCodeMappings } from '../data/entityStore'

type SectionTab = 'platform' | 'auxiliary'

export default function Codes() {
  const { can } = useRole()
  const dataScope = useDataScope()
  const platformSkuMappings = usePlatformSkuMappings()
  const codeMappings = useCodeMappings()
  const [searchParams, setSearchParams] = useSearchParams()

  const canPlatform = can('platform:read')
  const canCodes = can('code:read')

  const sectionTabs = useMemo(() => {
    const tabs: { id: SectionTab; label: string; count?: number }[] = []
    if (canPlatform) {
      const counts = bindingTabCounts(dataScope.scope(platformSkuMappings))
      tabs.push({ id: 'platform', label: '平台商品绑定', count: counts.all })
    }
    if (canCodes) {
      tabs.push({ id: 'auxiliary', label: '辅助编码', count: codeMappings.length })
    }
    return tabs
  }, [canPlatform, canCodes, dataScope, platformSkuMappings, codeMappings])

  const requestedTab = searchParams.get('tab') === 'auxiliary' ? 'auxiliary' : 'platform'
  const activeTab: SectionTab = sectionTabs.some(t => t.id === requestedTab)
    ? requestedTab
    : (sectionTabs[0]?.id ?? 'auxiliary')

  useEffect(() => {
    if (requestedTab !== activeTab) {
      setSearchParams({ tab: activeTab }, { replace: true })
    }
  }, [requestedTab, activeTab, setSearchParams])

  const setActiveTab = (id: string) => {
    setSearchParams({ tab: id }, { replace: true })
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="编码与绑定"
        desc="平台商品条码与仓库 SKU 映射，以及客户自定义码、箱唛等辅助编码"
      />

      {sectionTabs.length > 1 && (
        <div className="mb-4">
          <Tabs tabs={sectionTabs} active={activeTab} onChange={setActiveTab} />
        </div>
      )}

      {activeTab === 'platform' && canPlatform && <PlatformBindingsPanel />}
      {activeTab === 'auxiliary' && canCodes && <AuxiliaryCodesPanel />}
    </div>
  )
}
