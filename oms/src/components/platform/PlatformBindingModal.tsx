import { useEffect, useState } from 'react'
import { Plus, Minus, Copy } from 'lucide-react'
import { Button } from '../ui'
import { FormGrid, FormField, formInput, formSelect } from '../ui/form'
import {
  type PlatformSkuMapping, type PlatformBindingLine, type StoreAccount,
  PLATFORM_BINDING_STATUS_LABELS,
} from '../../data/mockData'
import { findProductByCode } from '../../data/platformBindingUtils'
import { useStores } from '../../data/entityStore'
import SkuFuzzyPicker from '../ui/SkuFuzzyPicker'

export interface BindingFormState {
  platform: PlatformSkuMapping['platform']
  storeId: string
  platformSkuId?: string
  platformBarcode: string
  platformTitle: string
  stockSource: PlatformSkuMapping['stockSource']
  lines: PlatformBindingLine[]
}

const emptyLine = (): PlatformBindingLine => ({
  internalSku: '',
  warehouseName: '',
  shortName: '',
  packType: '自带包装',
  qty: 1,
})

function toFormState(
  m: PlatformSkuMapping | null | undefined,
  storeList: StoreAccount[],
  initialValues?: Partial<BindingFormState>,
): BindingFormState {
  if (!m) {
    const firstStore = storeList.find(s => s.platform === 'Takealot' && s.status === 'connected')
    return {
      platform: initialValues?.platform ?? 'Takealot',
      storeId: initialValues?.storeId ?? firstStore?.id ?? storeList[0]?.id ?? '',
      platformSkuId: initialValues?.platformSkuId ?? '',
      platformBarcode: initialValues?.platformBarcode ?? '',
      platformTitle: initialValues?.platformTitle ?? '',
      stockSource: initialValues?.stockSource ?? 'owned',
      lines: initialValues?.lines?.length ? initialValues.lines.map(line => ({ ...line })) : [emptyLine()],
    }
  }
  return {
    platform: m.platform,
    storeId: m.storeId,
    platformSkuId: m.platformSkuId,
    platformBarcode: m.platformBarcode,
    platformTitle: m.platformTitle,
    stockSource: m.stockSource,
    lines: m.lines.length ? m.lines.map(l => ({ ...l })) : [emptyLine()],
  }
}

interface Props {
  open: boolean
  editing: PlatformSkuMapping | null
  initialValues?: Partial<BindingFormState>
  customerId?: string
  onClose: () => void
  onSave: (data: BindingFormState, editing: PlatformSkuMapping | null) => void
}

export default function PlatformBindingModal({ open, editing, initialValues, customerId, onClose, onSave }: Props) {
  const stores = useStores()
  const [form, setForm] = useState<BindingFormState>(() => toFormState(editing, stores, initialValues))

  useEffect(() => {
    if (open) setForm(toFormState(editing, stores, initialValues))
  }, [
    open,
    editing,
    stores,
    initialValues?.platform,
    initialValues?.storeId,
    initialValues?.platformSkuId,
    initialValues?.platformBarcode,
    initialValues?.platformTitle,
    initialValues?.stockSource,
  ])

  if (!open) return null

  const storeOptions = stores.filter(s => s.platform === form.platform && s.status !== 'disabled')

  const setLine = (idx: number, patch: Partial<PlatformBindingLine>) => {
    setForm(prev => {
      const lines = [...prev.lines]
      lines[idx] = { ...lines[idx], ...patch }
      return { ...prev, lines }
    })
  }

  const pickSku = (idx: number, sku: string) => {
    setForm(prev => {
      const lines = [...prev.lines]
      const trimmed = sku.trim()
      if (!trimmed) {
        lines[idx] = { ...lines[idx], internalSku: '', warehouseName: '' }
        return { ...prev, lines }
      }
      const prod = findProductByCode(trimmed, customerId)
      lines[idx] = {
        ...lines[idx],
        internalSku: prod?.internalSku ?? trimmed,
        warehouseName: prod?.name ?? lines[idx].warehouseName,
      }
      return { ...prev, lines }
    })
  }

  const handleSubmit = () => {
    onSave(form, editing)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl rounded-2xl bg-white shadow-2xl ring-1 ring-border-light" onClick={e => e.stopPropagation()}>
        <div className="border-b border-border-light px-6 py-5">
          <h3 className="font-semibold text-text-primary">
            {editing ? '编辑平台商品绑定' : '新增 OMS 平台商品'}
          </h3>
          <p className="mt-1 text-xs text-text-muted">平台 listing 与仓库 SKU 的映射关系，支持组合品多行</p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-6">
          <section>
            <h4 className="mb-3 text-sm font-semibold text-text-primary">平台商品信息</h4>
            <FormGrid cols={2}>
              <FormField label="平台名称" required>
                <select
                  className={formSelect()}
                  value={form.platform}
                  onChange={e => {
                    const platform = e.target.value as PlatformSkuMapping['platform']
                    const nextStore = stores.find(s => s.platform === platform && s.status === 'connected')
                    setForm(prev => ({ ...prev, platform, storeId: nextStore?.id ?? '' }))
                  }}
                >
                  <option value="Takealot">Takealot</option>
                  <option value="Shopify">Shopify</option>
                  <option value="Manual">Manual</option>
                </select>
              </FormField>
              <FormField label="平台店铺" required>
                <select className={formSelect()} value={form.storeId} onChange={e => setForm(prev => ({ ...prev, storeId: e.target.value }))}>
                  {storeOptions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.storeCode}</option>)}
                </select>
              </FormField>
              <FormField label="平台商品条码" required>
                <input className={formInput()} value={form.platformBarcode} onChange={e => setForm(prev => ({ ...prev, platformBarcode: e.target.value }))} placeholder="9901234567890" />
              </FormField>
              <FormField label="平台商品名称" className="sm:col-span-2">
                <input className={formInput()} value={form.platformTitle} onChange={e => setForm(prev => ({ ...prev, platformTitle: e.target.value }))} />
              </FormField>
              <FormField label="库存来源">
                <select className={formSelect()} value={form.stockSource} onChange={e => setForm(prev => ({ ...prev, stockSource: e.target.value as PlatformSkuMapping['stockSource'] }))}>
                  <option value="owned">自有库存</option>
                  <option value="catalog">货盘库存</option>
                </select>
              </FormField>
            </FormGrid>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-text-primary">仓库商品信息</h4>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => setForm(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }))}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="secondary" size="sm" disabled={form.lines.length <= 1} onClick={() => setForm(prev => ({ ...prev, lines: prev.lines.slice(0, -1) }))}>
                  <Minus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {form.lines.map((line, idx) => (
                <div key={idx} className="rounded-xl border border-border-light p-4">
                  <FormGrid cols={2}>
                    <FormField label="仓库商品编码" required hint="可输入 SKU 或模糊搜索后选择">
                      <SkuFuzzyPicker
                        value={line.internalSku}
                        onChange={sku => pickSku(idx, sku)}
                        onSelect={product => setLine(idx, {
                          internalSku: product.internalSku,
                          warehouseName: product.name,
                        })}
                        customerId={customerId}
                        placeholder="输入或搜索 SKU"
                      />
                    </FormField>
                    <FormField label="仓库商品名称">
                      <input className={formInput()} value={line.warehouseName} onChange={e => setLine(idx, { warehouseName: e.target.value })} />
                    </FormField>
                    <FormField label="仓库商品简称">
                      <input className={formInput()} value={line.shortName ?? ''} onChange={e => setLine(idx, { shortName: e.target.value })} />
                    </FormField>
                    <FormField label="仓库商品包装">
                      <select className={formSelect()} value={line.packType} onChange={e => setLine(idx, { packType: e.target.value })}>
                        <option>自带包装</option>
                        <option>仓库包装</option>
                      </select>
                    </FormField>
                    <FormField label="仓库商品数量" required hint="组合品时填写每件平台 SKU 对应的数量">
                      <input type="number" min={1} className={formInput()} value={line.qty} onChange={e => setLine(idx, { qty: Number(e.target.value) || 1 })} />
                    </FormField>
                  </FormGrid>
                </div>
              ))}
            </div>
            {form.lines.length > 1 && (
              <p className="mt-2 text-[11px] text-text-muted">当前为组合品映射：1 个平台 SKU 对应 {form.lines.length} 个仓库 SKU</p>
            )}
          </section>

          {editing && (
            <p className="text-xs text-text-muted">
              当前状态：<span className="font-semibold text-text-primary">{PLATFORM_BINDING_STATUS_LABELS[editing.status]}</span>
              {editing.hasInventory && ' · 有库存时变更需审核'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-light px-6 py-4">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit}>{editing?.hasInventory ? '提交变更申请' : '确认绑定'}</Button>
        </div>
      </div>
    </div>
  )
}

export function CopyBarcodeButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title="复制条码"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="ml-1 inline-flex text-text-muted hover:text-primary-600"
    >
      <Copy className="h-3 w-3" />
      {copied && <span className="sr-only">已复制</span>}
    </button>
  )
}
