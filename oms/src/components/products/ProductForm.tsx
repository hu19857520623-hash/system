import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, ImagePlus, X } from 'lucide-react'
import { Button } from '../ui'
import { FormSection, FormGrid, FormField, formInput, formSelect } from '../ui/form'
import { Product } from '../../data/mockData'
import { upsertLocalProduct, prepareNewProductSkus, updateLocalProducts, useProducts } from '../../data/inventoryStore'
import { createErpProduct } from '../../api/erp'
import { useRole } from '../../auth/RoleContext'
import { getCustomerCode, getCustomerIdForRole } from '../../data/dataScope'
import { getCustomerSkuDisplay } from '../../data/skuCode'

interface ProductFormProps {
  product?: Product
  mode?: 'create' | 'edit'
}

// 当前商品表只持久化主图，限制单图可避免刷新后其余预览丢失。
const MAX_PRODUCT_IMAGES = 1
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif)$/i

function isImageFile(file: File) {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT_PATTERN.test(file.name)
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`读取图片 ${file.name} 失败`))
    reader.readAsDataURL(file)
  })
}

function isImportedProduct(product?: Product) {
  return product?.productSource === 'import' || Boolean(product?.id.startsWith('prod-import-'))
}

function resolveProductStatus(submitReview: boolean, product?: Product): Product['productStatus'] {
  if (!submitReview) {
    if (product?.productStatus === 'available') return 'available'
    if (product?.productStatus === 'discarded') return 'discarded'
    return 'draft'
  }
  if (isImportedProduct(product)) return 'reviewing'
  return 'available'
}

export default function ProductForm({ product, mode = 'create' }: ProductFormProps) {
  const navigate = useNavigate()
  const { role } = useRole()

  const [sku, setSku] = useState(
    product ? getCustomerSkuDisplay(product, getCustomerCode(product.customerId)) : '',
  )
  const [name, setName] = useState(product?.name || '')
  const [nameEn, setNameEn] = useState(product?.declaredNameEn || '')
  const [customCode, setCustomCode] = useState(product?.customCode || '')
  const [declaredValue, setDeclaredValue] = useState(product?.declaredValue ?? 0)
  const [declaredCn, setDeclaredCn] = useState(product?.declaredNameCn || '')
  const [unit, setUnit] = useState(product?.unit ?? 'PCS')
  const [weightKg, setWeightKg] = useState(product?.weightKg ?? 0)
  const [lengthCm, setLengthCm] = useState(product?.lengthCm ?? 0)
  const [widthCm, setWidthCm] = useState(product?.widthCm ?? 0)
  const [heightCm, setHeightCm] = useState(product?.heightCm ?? 0)
  const [hasBattery, setHasBattery] = useState(product?.hasBattery ? 'yes' : 'no')
  const [images, setImages] = useState<string[]>(() => (product?.image ? [product.image] : []))
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)

  const appendImages = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    const picked = Array.from(files).filter(isImageFile)
    if (picked.length === 0) {
      window.alert('请选择 PNG、JPG、WEBP 或 GIF 格式的图片')
      if (imageInputRef.current) imageInputRef.current.value = ''
      return
    }

    const remaining = MAX_PRODUCT_IMAGES - images.length
    if (remaining <= 0) {
      window.alert(`最多上传 ${MAX_PRODUCT_IMAGES} 张图片`)
      if (imageInputRef.current) imageInputRef.current.value = ''
      return
    }

    const nextFiles = picked.slice(0, remaining)
    if (picked.length > remaining) {
      window.alert(`最多还能上传 ${remaining} 张，已自动保留前 ${remaining} 张`)
    }

    try {
      const dataUrls = await Promise.all(nextFiles.map(readImageFile))
      setImages(prev => [...prev, ...dataUrls])
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '图片读取失败')
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleSave = async (submitReview: boolean) => {
    setError('')
    const customerSku = sku.trim()
    if (!customerSku || !name.trim()) {
      setError('请填写 SKU 与产品名称')
      return
    }
    if (!lengthCm || !widthCm || !heightCm || lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      setError('请填写有效的长宽高（cm），客户上传产品时必须申报尺寸')
      return
    }

    const customerId = getCustomerIdForRole(role) || product?.customerId
    const customerCode = getCustomerCode(customerId ?? undefined)
    const isCreate = mode === 'create' || !product
    const prepared = isCreate
      ? prepareNewProductSkus(customerSku, customerCode, customerId ?? undefined)
      : null
    if (prepared && 'ok' in prepared && prepared.ok === false) {
      setError(prepared.error)
      return
    }

    const internalSku = isCreate
      ? (prepared as { customerSku: string; internalSku: string }).internalSku
      : product!.internalSku
    const productId = isCreate ? `p-${internalSku}` : product!.id

    setSaving(true)
    try {
      const local: Product = {
        id: productId,
        customerId: customerId || product?.customerId,
        internalSku,
        customerSku: isCreate ? customerSku : (product?.customerSku || customerSku),
        name: name.trim(),
        spec: nameEn || product?.spec || '',
        image: images[0] || '',
        price: product?.price ?? 0,
        cost: declaredValue || product?.cost || 0,
        availableQty: product?.availableQty ?? 0,
        lockedQty: product?.lockedQty ?? 0,
        customCode: customCode || undefined,
        category: '',
        categoryPath: '',
        weight: `${weightKg || 0} kg`,
        weightKg: weightKg || 0,
        lengthCm: lengthCm || 0,
        widthCm: widthCm || 0,
        heightCm: heightCm || 0,
        inCatalog: product?.inCatalog ?? false,
        productStatus: resolveProductStatus(submitReview, product),
        productSource: product?.productSource ?? 'manual',
        hasBattery: hasBattery === 'yes',
        certUploaded: product?.certUploaded ?? false,
        hasBoxSpec: product?.hasBoxSpec ?? false,
        declaredNameEn: nameEn || declaredCn,
        declaredNameCn: declaredCn || name,
        declaredValue: declaredValue || 0,
        unit,
      }
      const saved = await upsertLocalProduct(local)
      if (!saved.ok) {
        window.alert(saved.error)
        return
      }
      if (isCreate) {
        try {
          await createErpProduct({
            sku: internalSku,
            customerSku,
            productName: name.trim(),
            customerCode: customerCode !== '—' ? customerCode : undefined,
            customerId: customerId || undefined,
            barcode: customCode || undefined,
            lengthCm: lengthCm || undefined,
            widthCm: widthCm || undefined,
            heightCm: heightCm || undefined,
            weightKg: weightKg || undefined,
            declaredValue: declaredValue || undefined,
            declaredNameEn: nameEn || undefined,
            declaredNameCn: declaredCn || undefined,
            unit: unit || undefined,
            costRmb: declaredValue || undefined,
            spec: nameEn || undefined,
            hasBattery: hasBattery === 'yes',
            image: images[0] && images[0].length <= 500 ? images[0] : undefined,
          })
        } catch (error) {
          await updateLocalProducts([productId], { productStatus: 'draft' })
          window.alert(`ERP 创建失败，商品资料已保留在“草稿”中：${error instanceof Error ? error.message : String(error)}`)
          navigate('/products')
          return
        }
      }
      navigate('/products')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/重复\s*SKU|SKU.*已存在|已被使用/i.test(msg)) {
        window.alert(msg.includes('重复 SKU') ? msg : `重复 SKU：${internalSku}`)
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <FormSection num={1} title="产品信息">
        <FormGrid cols={3}>
          <FormField label="产品 SKU" required hint="客户自定义编码，可重复；系统会自动加客户代码前缀">
            <input value={sku} onChange={e => setSku(e.target.value)} placeholder="如 HX6" className={formInput()} readOnly={mode === 'edit' && !!product} />
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

      <FormSection num={3} title="产品图片">
        <p className="mb-3 text-xs text-text-muted">上传 1 张商品主图，保存后会持久化显示</p>
        <input
          id="product-image-input"
          ref={imageInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          onChange={event => void appendImages(event.target.files)}
        />
        <div className="flex flex-wrap gap-3">
          {images.map((src, index) => (
            <div key={`${src.slice(0, 32)}-${index}`} className="group relative h-24 w-24">
              <img src={src} alt={`产品图片 ${index + 1}`} className="h-24 w-24 rounded-lg object-cover ring-1 ring-border-light" />
              {index === 0 && (
                <span className="absolute left-1 top-1 rounded bg-primary-600 px-1.5 py-0.5 text-[10px] font-medium text-white">主图</span>
              )}
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                title="删除图片"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {images.length < MAX_PRODUCT_IMAGES && (
            <label
              htmlFor="product-image-input"
              className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface-muted/40 text-text-muted hover:border-primary-400 hover:text-primary-600"
            >
              <ImagePlus className="h-6 w-6" />
              <span className="mt-1 text-[10px]">上传图片</span>
            </label>
          )}
          <label
            htmlFor="product-image-input"
            onDragOver={event => { event.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => {
              event.preventDefault()
              setDragOver(false)
              void appendImages(event.dataTransfer.files)
            }}
            className={`flex min-h-24 min-w-[220px] flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors ${
              dragOver ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-border bg-surface-muted/30 text-text-muted'
            }`}
          >
            <Upload className={`h-6 w-6 ${dragOver ? 'text-primary-500' : 'text-text-muted/50'}`} />
            <p className="mt-2 text-xs">拖拽图片到此处，或点击上传</p>
            <p className="mt-1 text-[10px] text-text-muted">已上传 {images.length}/{MAX_PRODUCT_IMAGES}</p>
          </label>
        </div>
      </FormSection>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-xs text-red-700 ring-1 ring-red-100">{error}</p>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border-light bg-white/95 px-6 py-4 backdrop-blur-sm lg:pl-[260px]">
        <div className="mx-auto flex max-w-[1280px] justify-center gap-3">
          <Button variant="secondary" onClick={() => navigate('/products')} disabled={saving}>取消</Button>
          <Button variant="secondary" disabled={saving} onClick={() => void handleSave(false)}>
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button disabled={saving} onClick={() => void handleSave(true)}>
            {saving ? '提交中…' : '保存并审核'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function useProductById(id?: string) {
  const list = useProducts()
  return useMemo(() => list.find(p => p.id === id), [list, id])
}
