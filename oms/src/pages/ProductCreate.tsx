import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ProductForm, { useProductById } from '../components/products/ProductForm'
import { getCustomerSkuDisplay } from '../data/skuCode'
import { useDataScope } from '../auth/useDataScope'
import { productCopyTemplate } from '../data/productCopy'

export default function ProductCreate() {
  const { id } = useParams()
  const location = useLocation()
  const dataScope = useDataScope()
  const [searchParams] = useSearchParams()
  const copyId = searchParams.get('copy') || undefined
  const product = useProductById(id || copyId)
  const isEdit = Boolean(id)
  const isCopy = !isEdit && Boolean(copyId && product)
  if ((isEdit || copyId) && !product) {
    return <div className="page-shell" role="alert">
      <p>未找到该商品，或当前账号无权查看。请返回商品列表重新选择。</p>
      <Link to="/products" className="mt-4 inline-block text-primary-600">返回我的商品</Link>
    </div>
  }
  const skuLabel = product
    ? getCustomerSkuDisplay(product, dataScope.getCustomerCode(product.customerId))
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
              ? '草稿可继续编辑；保存并提交后将在 OMS 变为可用，并显示在 ERP 的 SKU 查询中'
            : '编辑后将更新 OMS 商品资料，并显示在 ERP 的 SKU 查询中'
            : '可先保存为草稿，确认资料后再提交为 OMS 可用商品'}
        </p>
      </div>
      <ProductForm key={`${location.key}:${isEdit ? 'edit' : isCopy ? 'copy' : 'create'}:${id || copyId || 'new'}`}
        product={isCopy && product ? productCopyTemplate(product) : product} mode={isEdit ? 'edit' : 'create'} />
    </div>
  )
}
