import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ProductForm, { useProductById } from '../components/products/ProductForm'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'
import { useDataScope } from '../auth/useDataScope'

export default function ProductCreate() {
  const { id } = useParams()
  const dataScope = useDataScope()
  const [searchParams] = useSearchParams()
  const copyId = searchParams.get('copy') || undefined
  const product = useProductById(id || copyId)
  const isEdit = Boolean(id)
  const isCopy = !isEdit && Boolean(copyId && product)
  const skuLabel = product
    ? (getPrimaryPlatformBarcode(product.internalSku, dataScope.bindingCustomerId ?? undefined) ?? product.internalSku)
    : ''

  return (
    <div className="page-shell">
      <div className="mb-4">
        <Link to={isEdit && id ? `/products/${id}` : '/products'} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> {isEdit ? '返回产品详情' : '返回我的商品'}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
          {isEdit ? `修改产品：${skuLabel}` : isCopy ? `复制产品：${skuLabel}` : '创建产品'}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {isEdit
            ? product?.productStatus === 'draft'
              ? '草稿可继续编辑；保存并提交后将创建 ERP 主数据并变为可用'
            : '编辑后将同步 ERP 商品主数据'
            : '可先保存为草稿，确认资料后再保存并提交至 ERP'}
        </p>
      </div>
      <ProductForm product={product} mode={isEdit ? 'edit' : 'create'} />
    </div>
  )
}
