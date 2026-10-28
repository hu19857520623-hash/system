
import { userFacingError } from '../../utils/userFacingError'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../ui'
import { FormSection, FormGrid, FormField, formInput, formSelect } from '../ui/form'
import { Product } from '../../data/mockData'
import { prepareNewProductSkus, useProducts, getProductsSnapshot } from '../../data/inventoryStore'
import { comparableProductMetadata, type ProductSaveReceipt } from '../../data/productSaveContract'
import { validateImportedProduct } from '../../data/productImportContract'
import { readProductSaveAttempt, storeProductSaveAttempt, requestProductSave, runProductSaveAttempt, type ProductSaveAttempt } from '../../data/productSaveWorkflow'
import ProductSaveRecovery, { finishProductSave } from './ProductSaveRecovery'
import { uploadErpProductDraftImage } from '../../api/erp'
import { useRole } from '../../auth/RoleContext'
import { getCustomerCode, getCustomerIdForRole } from '../../data/dataScope'
import { getCustomerSkuDisplay } from '../../data/skuCode'
import { validateCustomerSku } from '../../data/skuCode'
import { readFileAsDataUrl } from '../../data/fileUtils'
import { notifySuccess } from '../../utils/userNotify'
import { currentProductWriteScope } from '../../auth/productAccess'

interface ProductFormProps {
  product?: Product
  mode?: 'create' | 'edit'
}

function ProductEditBlocked({ product }: { product: Product }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <p className="font-medium">废弃商品请先恢复后再编辑</p>
      <p className="mt-1 text-xs text-amber-800/90">
        可在“废弃”页恢复该商品；恢复后即可在 OMS 编辑。
      </p>
      <Link to={`/products/${product.id}`} className="mt-3 inline-block text-xs font-medium text-primary-600 hover:underline">
        返回产品详情
      </Link>
    </div>
  )
}

function ProductEditorForm({ product, mode = 'create' }: ProductFormProps) {
  const navigate = useNavigate()
  const { role, can, user } = useRole()
  const customerForSave = getCustomerIdForRole(role) || product?.customerId
  const [initialRecovery] = useState(() => {
    try { return { attempt: user?.id && customerForSave ? readProductSaveAttempt(localStorage, user.id, customerForSave) : null, error: '' } }
    catch (cause) { return { attempt: null, error: userFacingError(cause) } }
  })
  const [attempt, setAttempt] = useState<ProductSaveAttempt | null>(initialRecovery.attempt)
  const [baseMetadata, setBaseMetadata] = useState(mode === 'edit' && product ? comparableProductMetadata(product) : null)
  const [createdId] = useState(() => initialRecovery.attempt?.mode === 'create' ? initialRecovery.attempt.product.id : `prod-${crypto.randomUUID()}`)
  const active = useRef(true), submitting = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const source = initialRecovery.attempt && (mode === 'create' && initialRecovery.attempt.mode === 'create' || initialRecovery.attempt.product.id === product?.id) ? initialRecovery.attempt.product : product

  const [sku, setSku] = useState(
    source ? getCustomerSkuDisplay(source, getCustomerCode(source.customerId)) : '',
  )
  const [name, setName] = useState(source?.name || '')
  const [nameEn, setNameEn] = useState(source?.declaredNameEn || '')
  const [customCode, setCustomCode] = useState(source?.customCode || '')
  const [declaredValue, setDeclaredValue] = useState(source?.declaredValue ?? 0)
  const [declaredCn, setDeclaredCn] = useState(source?.declaredNameCn || '')
  const [unit, setUnit] = useState(source?.unit ?? 'PCS')
  const [weightKg, setWeightKg] = useState(source?.weightKg ?? 0)
  const [lengthCm, setLengthCm] = useState(source?.lengthCm ?? 0)
  const [widthCm, setWidthCm] = useState(source?.widthCm ?? 0)
  const [heightCm, setHeightCm] = useState(source?.heightCm ?? 0)
  const [hasBattery, setHasBattery] = useState(source?.hasBattery ? 'yes' : 'no')
  const [image, setImage] = useState(source?.image || '')
  const [imageUploading, setImageUploading] = useState(false)
  const [savingAction, setSavingAction] = useState<'draft' | 'submit' | 'update' | null>(null)
  const saving = savingAction !== null
  const [error, setError] = useState('')
  const submittedProduct = Boolean(mode === 'edit' && product && product.productStatus !== 'draft')
  function onResolved(result: ProductSaveReceipt, original = attempt) {
    if (!original || !active.current) return
    setAttempt(null)
    if (result.status === 'cancelled') {
      if (original.mode === 'update' && original.product.id === product?.id) {
        notifySuccess('原保存请求已取消，已重新载入最新商品资料，请核对后继续编辑')
        navigate(`/products/${original.product.id}/edit`)
      } else setError('原保存请求已取消，当前表单尚未提交；请核对资料后继续编辑，或返回商品列表重新打开')
      return
    }
    const canonical = getProductsSnapshot().find(row => row.id === original.product.id)
    if (canonical) setBaseMetadata(comparableProductMetadata(canonical))
    notifySuccess('商品保存已确认，请继续查看或编辑')
    navigate(original.action === 'submit' ? '/products' : original.action === 'update' ? `/products/${original.product.id}` : `/products/${original.product.id}/edit`)
  }

  const handleImageUpload = async (file?: File) => {
    const owner = currentProductWriteScope()
    if (!owner) { setError('当前账号没有商品维护权限，请返回商品列表查看'); return }
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('仅支持不超过 5MB 的 JPG、PNG、GIF 或 WebP 商品图片')
      return
    }
    setError('')
    setImageUploading(true)
    try {
      const contentBase64 = await readFileAsDataUrl(file)
      if (owner !== currentProductWriteScope()) return
      const uploaded = await uploadErpProductDraftImage(file.name, contentBase64)
      if (owner !== currentProductWriteScope()) return
      setImage(uploaded.imageUrl)
    } catch (error) {
      if (owner === currentProductWriteScope()) setError(userFacingError(`商品图片上传失败：${error instanceof Error ? error.message : String(error)}`))
    } finally {
      setImageUploading(false)
    }
  }

  const handleSave = async (action: 'draft' | 'submit' | 'update') => {
    if (submitting.current || attempt || initialRecovery.error) return
    setError('')
    const owner = currentProductWriteScope()
    if (!owner) { setError('当前账号没有商品维护权限，请返回商品列表查看'); return }
    if (imageUploading) {
      setError('请等待商品图片上传完成')
      return
    }
    const customerSku = sku.trim()
    if (!customerSku || !name.trim()) {
      setError('请填写 SKU 与产品名称')
      return
    }
    const skuError = validateCustomerSku(customerSku)
    if (skuError) {
      setError(skuError)
      return
    }
    if (action !== 'draft' && (!lengthCm || !widthCm || !heightCm || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0)) {
      setError('请填写有效的长宽高（cm），客户上传产品时必须申报尺寸')
      return
    }

    const customerId = getCustomerIdForRole(role) || product?.customerId
    const customerCode = getCustomerCode(customerId ?? undefined)
    const isCreate = mode === 'create' || !product
    const isDraft = mode === 'edit' && product?.productStatus === 'draft'
    const prepared = isCreate || isDraft
      ? prepareNewProductSkus(customerSku, customerCode, customerId ?? undefined, isDraft ? product?.id : undefined)
      : null
    if (prepared && 'ok' in prepared && prepared.ok === false) {
      setError(userFacingError(prepared.error))
      return
    }

    const internalSku = isCreate || isDraft
      ? (prepared as { customerSku: string; internalSku: string }).internalSku
      : product!.internalSku
    const productId = isCreate ? createdId : product!.id

    submitting.current = true
    setSavingAction(action)
    try {
      const local: Product = {
        id: productId,
        customerId: customerId || product?.customerId,
        internalSku,
        customerSku,
        name: name.trim(),
        spec: nameEn || product?.spec || '',
        image,
        price: product?.price ?? 0,
        cost: declaredValue || product?.cost || 0,
        availableQty: product?.availableQty ?? 0,
        lockedQty: product?.lockedQty ?? 0,
        customCode: customCode || undefined,
        category: product?.category || '',
        categoryPath: product?.categoryPath || '',
        weight: `${weightKg || 0} kg`,
        weightKg: weightKg || 0,
        lengthCm: lengthCm || 0,
        widthCm: widthCm || 0,
        heightCm: heightCm || 0,
        inCatalog: product?.inCatalog ?? false,
        productStatus: action === 'update' ? product!.productStatus : action === 'submit' ? 'available' : 'draft',
        productSource: product?.productSource ?? 'manual',
        hasBattery: hasBattery === 'yes',
        certUploaded: product?.certUploaded ?? false,
        hasBoxSpec: lengthCm > 0 && widthCm > 0 && heightCm > 0,
        outerBoxBarcode: product?.outerBoxBarcode,
        declaredNameEn: nameEn,
        declaredNameCn: declaredCn,
        declaredValue: declaredValue || 0,
        unit,
      }
      if (local.productStatus === 'available') {
        const invalid = validateImportedProduct(local as unknown as Record<string, unknown>)
        if (invalid) throw new Error(invalid)
      }
      if (!user?.id || !local.customerId) throw new Error('请使用已绑定客户的原账号保存商品')
      const original: ProductSaveAttempt = { requestId: crypto.randomUUID(), userId: user.id, customerId: local.customerId, mode: isCreate ? 'create' : 'update', action, expected: isCreate ? null : baseMetadata, product: local }
      storeProductSaveAttempt(localStorage, original); setAttempt(original)
      const result = await runProductSaveAttempt(() => requestProductSave('submit', original), original, owner, currentProductWriteScope)
      if (!active.current || owner !== currentProductWriteScope()) return
      if (await finishProductSave(original, result, owner, () => active.current)) onResolved(result, original)
    } catch (e) {
      if (!active.current || owner !== currentProductWriteScope()) return
      const msg = e instanceof Error ? e.message : String(e)
      if (/重复\s*SKU|SKU.*已存在|已被使用/i.test(msg)) {
        setError(userFacingError(msg.includes('重复 SKU') ? msg : `重复 SKU：${internalSku}`))
      } else {
        setError(userFacingError(msg))
      }
    } finally {
      submitting.current = false
      setSavingAction(null)
    }
  }

  if (!can('product:write')) return <div role="alert" className="rounded-xl border border-border bg-white p-5">
    <p>当前账号没有商品维护权限，不能保存或上传商品资料。</p>
    <Link to="/products" className="mt-3 inline-block text-primary-600">返回我的商品</Link>
    {product && <Link to={`/products/${product.id}`} className="ml-4 text-primary-600">查看产品详情</Link>}
  </div>
  if (initialRecovery.error) return <div role="alert"><p>{initialRecovery.error}</p><Link to="/products">返回商品列表</Link></div>
  if (attempt) return <>{error && <p role="alert" className="text-red-600">{error}</p>}<ProductSaveRecovery attempt={attempt} disabled={saving} onResolved={result => onResolved(result)} /></>
  return (
    <div className="space-y-4 pb-24">
      <p className="text-xs text-text-muted">
        {submittedProduct
          ? '保存修改会更新 OMS 商品资料，并显示在 ERP 的 SKU 查询中。'
          : '“保存”仅保存为草稿；“保存并提交”会使 OMS 商品变为可用，并显示在 ERP 的 SKU 查询中。'}
      </p>

      <FormSection num={1} title="产品信息">
        <FormGrid cols={3}>
          <FormField label="产品 SKU" required hint={submittedProduct ? '商品提交后 SKU 已锁定；如需变更，请创建使用新编号的商品。' : '客户自定义编码，最多 11 位；与所有客户及 ERP SKU 全局不可重复'}>
            <input value={sku} maxLength={11} disabled={submittedProduct} onChange={e => setSku(e.target.value)} placeholder="如 HX6" className={formInput()} />
          </FormField>
          <FormField label="产品名称" required hint="中文/英文/数字/连字符/下划线，最多 150 字符">
            <input value={name} onChange={e => setName(e.target.value)} className={formInput()} />
          </FormField>
          <FormField label="产品名称 (EN)" required>
            <input value={nameEn} onChange={e => setNameEn(e.target.value)} className={formInput()} />
          </FormField>
          <FormField label="自定义编号" hint="可与其他产品重复">
            <input value={customCode} onChange={e => setCustomCode(e.target.value)} className={formInput()} />
          </FormField>
          <FormField label="申报价值 (人民币)" required hint="出口报关用单价">
            <input type="number" step="0.01" value={declaredValue} onChange={e => setDeclaredValue(Number(e.target.value))} className={formInput()} />
          </FormField>
          <FormField label="中文申报品名" required>
            <input value={declaredCn} onChange={e => setDeclaredCn(e.target.value)} className={formInput()} />
          </FormField>
          <FormField label="英文申报品名" required>
            <input value={nameEn} onChange={e => setNameEn(e.target.value)} className={formInput()} />
          </FormField>
          <FormField label="产品单位" required>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={formSelect()}>
              <option value="PCS">PCS</option>
              <option value="SET">SET</option>
              <option value="BOX">BOX</option>
            </select>
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection num={2} title="规格信息">
        <FormGrid cols={3}>
          <FormField label="产品重量 (KG)" required hint="0.001–9999.999，保留 3 位小数">
            <input type="number" step="0.001" value={weightKg} onChange={e => setWeightKg(Number(e.target.value))} className={formInput()} />
          </FormField>
          <FormField label="含电池">
            <select value={hasBattery} onChange={e => setHasBattery(e.target.value)} className={formSelect()}>
              <option value="no">不含电池</option>
              <option value="yes">含电池</option>
            </select>
          </FormField>
          <FormField label="长 (CM)" required hint="0.01–9999.99，保留 2 位小数">
            <input type="number" step="0.01" value={lengthCm} onChange={e => setLengthCm(Number(e.target.value))} className={formInput()} />
          </FormField>
          <FormField label="宽 (CM)" required hint="0.01–9999.99，保留 2 位小数">
            <input type="number" step="0.01" value={widthCm} onChange={e => setWidthCm(Number(e.target.value))} className={formInput()} />
          </FormField>
          <FormField label="高 (CM)" required hint="0.01–9999.99，保留 2 位小数">
            <input type="number" step="0.01" value={heightCm} onChange={e => setHeightCm(Number(e.target.value))} className={formInput()} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection num={3} title="商品图片">
        <div className="flex items-center gap-4">
          {image ? <img src={image} alt={name || '商品图片'} className="h-24 w-24 rounded-lg object-cover ring-1 ring-border-light" />
            : <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface-muted text-xs text-text-muted">无图片</div>}
          {!submittedProduct && <label className="cursor-pointer text-sm text-primary-600">
            {imageUploading ? '上传中…' : image ? '更换图片' : '上传图片'}
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" disabled={imageUploading || saving} onChange={event => void handleImageUpload(event.target.files?.[0])} />
          </label>}
        </div>
        <p className="mt-2 text-xs text-text-muted">图片上传后会随 OMS 商品保存；支持 JPG、PNG、GIF、WebP，最大 5MB。</p>
      </FormSection>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-xs text-red-700 ring-1 ring-red-100">{error}</p>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border-light bg-white/95 px-6 py-4 backdrop-blur-sm lg:pl-[260px]">
        <div className="mx-auto flex max-w-[1280px] justify-center gap-3">
          <Button variant="secondary" onClick={() => navigate('/products')} disabled={saving || imageUploading}>取消</Button>
          {submittedProduct ? (
            <Button disabled={saving} onClick={() => void handleSave('update')}>
              {savingAction === 'update' ? '保存中…' : '保存修改'}
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={saving || imageUploading} onClick={() => void handleSave('draft')}>
                {savingAction === 'draft' ? '保存中…' : '保存'}
              </Button>
              <Button disabled={saving || imageUploading} onClick={() => void handleSave('submit')}>
                {savingAction === 'submit' ? '提交中…' : '保存并提交'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProductForm({ product, mode = 'create' }: ProductFormProps) {
  if (mode === 'edit' && !product) {
    return <div role="alert" className="rounded-xl border border-border bg-white p-5">
      <p>未找到该商品，或当前账号无权编辑。请返回商品列表重新选择。</p>
      <Link to="/products" className="mt-3 inline-block text-primary-600">返回我的商品</Link>
    </div>
  }
  if (mode === 'edit' && product?.inCatalog) return <div role="alert" className="rounded-xl border border-border bg-white p-5">
    <p>货盘商品由ERP维护，请在ERP修改后同步；当前页面可查看商品资料。</p>
    <Link to={`/products/${product.id}`} className="mt-3 inline-block text-primary-600">返回产品详情</Link>
    <Link to="/products" className="ml-4 text-primary-600">返回我的商品</Link>
  </div>
  if (mode === 'edit' && product?.productStatus === 'discarded') {
    return <ProductEditBlocked product={product} />
  }
  return <ProductEditorForm key={currentProductWriteScope()} product={product} mode={mode} />
}

export function useProductById(id?: string) {
  const list = useProducts()
  return useMemo(() => list.find(p => p.id === id), [list, id])
}
