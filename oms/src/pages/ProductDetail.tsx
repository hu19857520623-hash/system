import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronLeft, Pencil } from 'lucide-react'
import {
  Badge, Button, Card, MonoCode, Table, Tabs,
} from '../components/ui'
import { getProductLogs, statusLabels, formatCurrency } from '../data/mockData'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'
import { useProducts } from '../data/inventoryStore'
import { useProductById } from '../components/products/ProductForm'

const detailTabs = [
  { id: 'logs', label: '产品日志' },
  { id: 'images', label: '产品图片' },
]

function displaySku(internalSku: string) {
  return getPrimaryPlatformBarcode(internalSku) ?? internalSku
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 py-2">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text-primary">{value}</p>
    </div>
  )
}

export default function ProductDetail() {
  const { id } = useParams()
  const product = useProductById(id)
  const allProducts = useProducts()
  const [tab, setTab] = useState('logs')

  const logs = useMemo(() => (id ? getProductLogs(id, allProducts) : []), [id, allProducts])

  if (!id) return <Navigate to="/products" replace />
  if (!product) {
    const exists = allProducts.some(p => p.id === id)
    if (!exists) return <Navigate to="/products" replace />
    return (
      <div className="page-shell">
        <p className="text-sm text-text-muted">加载中…</p>
      </div>
    )
  }

  const skuLabel = displaySku(product.internalSku)

  return (
    <div className="page-shell">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/products" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary-600">
            <ChevronLeft className="h-3.5 w-3.5" /> 返回我的商品
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
              产品：<MonoCode>{skuLabel}</MonoCode>
            </h1>
            <Badge status={product.productStatus} label={statusLabels[product.productStatus]} />
          </div>
        </div>
        <Link to={`/products/${product.id}/edit`}>
          <Button variant="secondary" size="sm">
            <Pencil className="h-3.5 w-3.5" /> 编辑
          </Button>
        </Link>
      </div>

      <Card className="mb-4 p-5">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <DetailField label="产品状态" value={statusLabels[product.productStatus]} />
          <DetailField label="SKU" value={<MonoCode>{skuLabel}</MonoCode>} />
          <DetailField label="内部 SKU" value={<MonoCode>{product.internalSku}</MonoCode>} />
          <DetailField label="自定义编号" value={product.customCode ? <MonoCode>{product.customCode}</MonoCode> : '—'} />
          <DetailField label="产品名称" value={product.name} />
          <DetailField label="规格" value={product.spec || '—'} />
          <DetailField label="中文申报品名" value={product.declaredNameCn} />
          <DetailField label="英文申报品名" value={product.declaredNameEn} />
          <DetailField label="重量 (KG)" value={product.weightKg.toFixed(3)} />
          <DetailField
            label="长*宽*高 (CM)"
            value={`${product.lengthCm.toFixed(2)} * ${product.widthCm.toFixed(2)} * ${product.heightCm.toFixed(2)}`}
          />
          <DetailField label="产品单价" value={formatCurrency(product.price)} />
          <DetailField label="申报价值" value={formatCurrency(product.declaredValue)} />
          <DetailField label="产品单位" value={product.unit} />
          <DetailField label="含电池" value={product.hasBattery ? '是' : '否'} />
          <DetailField label="上传证书" value={product.certUploaded ? '是' : '否'} />
          <DetailField label="产品箱规" value={product.hasBoxSpec ? '是' : '否'} />
          <DetailField label="外箱条码" value={product.outerBoxBarcode ?? '—'} />
          <DetailField label="可售库存" value={String(product.availableQty)} />
          <DetailField label="锁定库存" value={String(product.lockedQty)} />
          <DetailField label="货盘商品" value={product.inCatalog ? '是' : '否'} />
        </div>
      </Card>

      <div className="mb-4">
        <Tabs tabs={detailTabs} active={tab} onChange={setTab} />
      </div>

      <Card className="overflow-hidden">
        {tab === 'logs' && (
          <Table>
            <thead className="table-head">
              <tr>
                <th>日志</th>
                <th>操作员</th>
                <th>时间</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody className="table-body">
              {logs.map(log => (
                <tr key={log.id} className="table-row">
                  <td className="table-cell text-sm">{log.action}</td>
                  <td className="table-cell text-sm">{log.operator}</td>
                  <td className="table-cell text-sm font-mono text-text-secondary">{log.createdAt}</td>
                  <td className="table-cell text-sm font-mono text-text-muted">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {tab === 'images' && (
          <div className="p-6">
            {product.image ? (
              <img src={product.image} alt={product.name} className="h-32 w-32 rounded-lg object-cover ring-1 ring-border-light" />
            ) : (
              <p className="text-center text-sm text-text-muted">暂无产品图片</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
