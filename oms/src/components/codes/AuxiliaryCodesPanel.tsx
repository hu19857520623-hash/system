import { useState } from 'react'
import { AlertCircle, History } from 'lucide-react'
import { Badge, Card, SearchInput, MonoCode, Tabs, Table, TableFooter } from '../ui'
import { useCodeMappings } from '../../data/entityStore'

export default function AuxiliaryCodesPanel() {
  const codeMappings = useCodeMappings()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const filtered = codeMappings.filter(c => {
    const matchSearch = !search || c.internalSku.includes(search) || c.codeValue.includes(search) || c.productName.includes(search)
    const matchTab = tab === 'all' || c.codeType === tab || (tab === 'pending' && c.status === 'pending_review')
    return matchSearch && matchTab
  })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">客户自定义码、箱唛等辅助编码（不含平台商品条码绑定）</p>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3.5 ring-1 ring-amber-200/60">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="text-xs text-amber-800">
          <p className="font-medium">编码变更规则</p>
          <p className="mt-0.5 text-amber-700">已有库存或订单的商品不允许直接覆盖编码，需提交变更申请，审核通过后生成新版本。</p>
          <p className="mt-2 text-amber-700">辅助编码的新增与变更申请尚未在本版本开放，请联系管理员处理。</p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs tabs={[
          { id: 'all', label: '全部', count: codeMappings.length },
          { id: 'custom', label: '客户码', count: codeMappings.filter(c => c.codeType === 'custom').length },
          { id: 'box_label', label: '箱唛', count: codeMappings.filter(c => c.codeType === 'box_label').length },
          { id: 'pending', label: '待审核', count: codeMappings.filter(c => c.status === 'pending_review').length },
        ]} active={tab} onChange={setTab} />
        <SearchInput placeholder="搜索编码或 SKU..." value={search} onChange={setSearch} className="w-64" />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>内部 SKU</th>
              <th>商品名称</th>
              <th>编码类型</th>
              <th>编码值</th>
              <th>版本</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.map(c => (
              <tr key={c.id} className="table-row">
                <td className="table-cell"><MonoCode>{c.internalSku}</MonoCode></td>
                <td className="table-cell text-xs text-text-primary">{c.productName}</td>
                <td className="table-cell text-xs text-text-secondary">
                  {c.codeType === 'custom' ? '客户自定义' : '箱唛'}
                </td>
                <td className="table-cell"><MonoCode>{c.codeValue}</MonoCode></td>
                <td className="table-cell text-xs text-text-muted">v{c.version}</td>
                <td className="table-cell"><Badge status={c.status} /></td>
                <td className="table-cell text-xs text-text-muted">{c.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">最近变更记录</h3>
        </div>
        <ul className="space-y-2 text-xs text-text-secondary">
          <li className="flex justify-between"><span>SKU-JNB-10034 · 平台条码变更（待审核）</span><Badge status="pending_review" /></li>
          <li className="flex justify-between"><span>SKU-JNB-10021 · 客户码 v1→v2</span><Badge status="active" /></li>
        </ul>
      </Card>
    </>
  )
}
