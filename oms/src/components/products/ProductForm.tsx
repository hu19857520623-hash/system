import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

function ProductEditBlocked({ product }: { product: Product }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      <p className="font-medium">SKU 主数据请在 ERP 维护</p>
      <p className="mt-1 text-xs text-amber-800/90">
        OMS 此处修改只会写入本地缓存，不会同步 ERP，也无法上传证书或主图。请使用 ERP 产品管理更新资料。
      </p>
      <Link to={`/products/${product.id}`} className="mt-3 inline-block text-xs font-medium text-primary-600 hover:underline">
        返回产品详情
      </Link>
    </div>
  )
}

function ProductCreateForm({ product, mode = 'create' }: ProductFormProps) {
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
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
        image: product?.image || '',
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
        productStatus: 'draft',
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
          })
          await updateLocalProducts([productId], { productStatus: 'available' })
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
      <p className="text-xs text-text-muted">
        保存后将创建 ERP 主数据 SKU；证书、主图等请在 ERP 产品管理中维护。
      </p>

      <FormSection num={1} title="产品信息">
        <FormGrid cols={3}>
          <FormField label="产品 SKU" required hint="客户自定义编码，可重复；系统会自动加客户代码前缀">
            <input value={sku} onChange={e => setSku(e.target.value)} placeholder="如 HX6" className={formInput()} />
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

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-xs text-red-700 ring-1 ring-red-100">{error}</p>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border-light bg-white/95 px-6 py-4 backdrop-blur-sm lg:pl-[260px]">
        <div className="mx-auto flex max-w-[1280px] justify-center gap-3">
          <Button variant="secondary" onClick={() => navigate('/products')} disabled={saving}>取消</Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存并创建 ERP SKU'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function ProductForm({ product, mode = 'create' }: ProductFormProps) {
  if (mode === 'edit' && product) {
    return <ProductEditBlocked product={product} />
  }
  return <ProductCreateForm product={product} mode={mode} />
}

export function useProductById(id?: string) {
  const list = useProducts()
  return useMemo(() => list.find(p => p.id === id), [list, id])
}
