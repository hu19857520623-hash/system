import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ProductForm, { useProductById } from '../components/products/ProductForm'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'

export default function ProductCreate() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const copyId = searchParams.get('copy') || undefined
  const product = useProductById(id || copyId)
  const isEdit = Boolean(id)
  const isCopy = !isEdit && Boolean(copyId && product)
  const skuLabel = product
    ? (getPrimaryPlatformBarcode(product.internalSku) ?? product.internalSku)
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
        <p className="mt-1 text-sm text-text-muted">填写产品信息、规格尺寸与图片</p>
      </div>
      <ProductForm product={product} mode={isEdit ? 'edit' : 'create'} />
    </div>
  )
}
