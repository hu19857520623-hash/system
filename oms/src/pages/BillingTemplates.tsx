import { useEffect, useMemo, useState } from 'react'
import { Save, Plus, Trash2 } from 'lucide-react'
import {
  Button, Card, PageHeader, Badge,
} from '../components/ui'
import { FormField, formInput, formSelect } from '../components/ui/form'
import {
  DEFAULT_PRICE_TEMPLATE, DEFAULT_STORAGE_TEMPLATE,
  defaultRegionShippingRates, defaultPickupRegionRule,
  syncPriceTemplateRegions, regionLabel,
  enabledDispatchRules,
  type PriceTemplate, type StorageRentTemplate,
} from '../data/feeTemplates'
import {
  useFeeTemplates, updatePriceTemplates, updateStorageTemplate, addPriceTemplate, removePriceTemplate,
  getPriceTemplatesForRegion,
} from '../data/feeTemplateStore'
import { useDataScope } from '../auth/useDataScope'
import { Navigate, Link } from 'react-router-dom'

export default function BillingTemplates() {
  const dataScope = useDataScope()
  const { priceTemplates, storageTemplate, regionDispatchRules } = useFeeTemplates()
  const dispatchRules = enabledDispatchRules(regionDispatchRules)
  const [activeRegion, setActiveRegion] = useState(dispatchRules[0]?.code ?? 'jhb')
  const regionTemplates = useMemo(
    () => getPriceTemplatesForRegion(activeRegion),
    [priceTemplates, activeRegion],
  )
  const [selectedId, setSelectedId] = useState(regionTemplates[0]?.id ?? '')
  const [priceDraft, setPriceDraft] = useState<PriceTemplate>(
    regionTemplates[0] ?? DEFAULT_PRICE_TEMPLATE,
  )
  const [storageDraft, setStorageDraft] = useState<StorageRentTemplate>(storageTemplate)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const list = getPriceTemplatesForRegion(activeRegion)
    const tpl = list.find(t => t.id === selectedId) ?? list[0]
    if (tpl) {
      setPriceDraft(tpl)
      if (selectedId !== tpl.id) setSelectedId(tpl.id)
    }
  }, [priceTemplates, activeRegion])

  if (!dataScope.isAdmin) {
    return <Navigate to="/" replace />
  }

  const activeRule = dispatchRules.find(r => r.code === activeRegion)

  const selectTemplate = (id: string) => {
    const tpl = regionTemplates.find(t => t.id === id)
    if (tpl) {
      setSelectedId(id)
      setPriceDraft(tpl)
    }
  }

  const saveAll = () => {
    const nextTemplates = priceTemplates.map(t => t.id === priceDraft.id ? priceDraft : t)
    updatePriceTemplates(nextTemplates)
    updateStorageTemplate(storageDraft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const resetDefaults = () => {
    const synced = syncPriceTemplateRegions({ ...DEFAULT_PRICE_TEMPLATE, regionCode: activeRegion }, regionDispatchRules)
    setPriceDraft(synced)
    setStorageDraft({ ...DEFAULT_STORAGE_TEMPLATE })
  }

  const createTemplate = () => {
    const id = `pt-${activeRegion}-${Date.now()}`
    const count = regionTemplates.length
    const tpl = syncPriceTemplateRegions({
      ...DEFAULT_PRICE_TEMPLATE,
      id,
      regionCode: activeRegion,
      name: `${regionLabel(activeRegion, regionDispatchRules)} · 模板 ${count + 1}`,
      shippingByRegion: { [activeRegion]: defaultRegionShippingRates() },
      pickupByRegion: { [activeRegion]: defaultPickupRegionRule() },
      status: 'draft',
      updatedAt: new Date().toISOString().slice(0, 10),
    }, regionDispatchRules)
    addPriceTemplate(tpl)
    setSelectedId(id)
    setPriceDraft(tpl)
  }

  const deleteTemplate = () => {
    if (regionTemplates.length <= 1) {
      window.alert(`${regionLabel(activeRegion, regionDispatchRules)} 至少保留一个价格模板`)
      return
    }
    if (!window.confirm(`确定删除模板「${priceDraft.name}」？已绑定该模板的客户将回退到该地区默认模板。`)) return
    removePriceTemplate(priceDraft.id)
    const next = regionTemplates.find(t => t.id !== priceDraft.id)
    if (next) {
      setSelectedId(next.id)
      setPriceDraft(next)
    }
  }

  const regionRates = priceDraft.shippingByRegion[activeRegion]
    ?? defaultRegionShippingRates()
  const pickupRule = priceDraft.pickupByRegion?.[activeRegion]
    ?? defaultPickupRegionRule()

  return (
    <div className="page-shell">
      <PageHeader
        title="价格模板"
        desc="按收货地区（JHB / CPT / DBN）分别维护出库价格模板；在账号管理中为每个客户绑定各地区的模板"
        action={
          <div className="flex gap-2">
            <Link to="/system/region-template">
              <Button variant="secondary" size="sm">地区模板</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={resetDefaults}>恢复默认</Button>
            <Button size="sm" onClick={saveAll}>
              <Save className="h-3.5 w-3.5" /> {saved ? '已保存' : '保存模板'}
            </Button>
          </div>
        }
      />

      <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
        <p className="text-xs font-semibold text-amber-900">预扣款规则</p>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
          客户提交出库单时，系统根据<strong>目的地区</strong>读取该客户绑定的<strong>对应地区价格模板</strong>，
          按 SKU 尺寸与配送方式试算费用。卡派/快递按体积或重量计费；自提按该地区自提费另加操作费。
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {dispatchRules.map(r => (
          <button
            key={r.code}
            type="button"
            onClick={() => {
              setActiveRegion(r.code)
              const list = getPriceTemplatesForRegion(r.code)
              setSelectedId(list[0]?.id ?? '')
              if (list[0]) setPriceDraft(list[0])
            }}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              activeRegion === r.code
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-white text-text-secondary ring-1 ring-border-light hover:bg-surface-muted'
            }`}
          >
            {r.label}
            <span className="ml-1.5 font-normal opacity-80">
              ({getPriceTemplatesForRegion(r.code).length} 套)
            </span>
          </button>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={`${regionLabel(activeRegion, regionDispatchRules)} · 编辑模板`}>
            <select
              className={formSelect('min-w-[220px]')}
              value={selectedId}
              onChange={e => selectTemplate(e.target.value)}
            >
              {regionTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </FormField>
          <Button variant="secondary" size="sm" onClick={createTemplate}>
            <Plus className="h-3.5 w-3.5" /> 新建{regionLabel(activeRegion, regionDispatchRules)}模板
          </Button>
          <Button variant="danger-outline" size="sm" onClick={deleteTemplate}>
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
        {activeRule && (
          <p className="mt-2 text-[11px] text-text-muted">
            地区默认配送：{activeRule.shippingMethod}
            {activeRule.remark ? ` · ${activeRule.remark}` : ''}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                {regionLabel(activeRegion, regionDispatchRules)} · 出库预扣
              </h2>
              <p className="mt-0.5 text-[11px] text-text-muted">更新 {priceDraft.updatedAt}</p>
            </div>
            <Badge status="active" label={priceDraft.status === 'active' ? '生效中' : '草稿'} />
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <FormField label="模板名称">
                <input
                  className={formInput()}
                  value={priceDraft.name}
                  onChange={e => setPriceDraft(p => ({ ...p, name: e.target.value }))}
                />
              </FormField>
              <FormField label="状态">
                <select
                  className={formSelect()}
                  value={priceDraft.status}
                  onChange={e => setPriceDraft(p => ({ ...p, status: e.target.value as 'active' | 'draft' }))}
                >
                  <option value="active">生效中</option>
                  <option value="draft">草稿</option>
                </select>
              </FormField>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-text-secondary">操作费</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['perOrderBase', '每单基础 (¥)'],
                  ['perUnit', '每件 (¥)'],
                  ['perSkuLine', '每 SKU 行 (¥)'],
                ] as const).map(([key, label]) => (
                  <FormField key={key} label={label}>
                    <input
                      type="number"
                      step="0.01"
                      className={formInput()}
                      value={priceDraft.handling[key]}
                      onChange={e => setPriceDraft(p => ({
                        ...p,
                        handling: { ...p.handling, [key]: Number(e.target.value) },
                      }))}
                    />
                  </FormField>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-text-secondary">物流费</p>
              <p className="mb-3 text-[11px] text-text-muted">卡派按体积 (m³)、快递按重量 (kg)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['卡派', '快递'] as const).map(channel => {
                  const rule = regionRates[channel]
                  return (
                    <div key={channel} className="rounded-md bg-surface-muted/60 p-2.5 ring-1 ring-border-light">
                      <p className="mb-2 text-[11px] font-medium text-text-secondary">{channel}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label={channel === '卡派' ? '单价 (¥/m³)' : '单价 (¥/kg)'}>
                          <input
                            type="number"
                            step="0.01"
                            className={formInput()}
                            value={channel === '卡派' ? (rule.ratePerCbm ?? 0) : (rule.ratePerKg ?? 0)}
                            onChange={e => {
                              const val = Number(e.target.value)
                              setPriceDraft(p => ({
                                ...p,
                                shippingByRegion: {
                                  [activeRegion]: {
                                    ...regionRates,
                                    [channel]: channel === '卡派'
                                      ? { ...rule, ratePerCbm: val }
                                      : { ...rule, ratePerKg: val },
                                  },
                                },
                              }))
                            }}
                          />
                        </FormField>
                        <FormField label="最低 (¥)">
                          <input
                            type="number"
                            className={formInput()}
                            value={rule.minCharge}
                            onChange={e => setPriceDraft(p => ({
                              ...p,
                              shippingByRegion: {
                                [activeRegion]: {
                                  ...regionRates,
                                  [channel]: { ...rule, minCharge: Number(e.target.value) },
                                },
                              },
                            }))}
                          />
                        </FormField>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-text-secondary">自提费</p>
              <p className="mb-3 text-[11px] text-text-muted">客户选择自提时，按每单 + 每件计费（含最低收费）</p>
              <div className="rounded-lg bg-emerald-50/60 p-3 ring-1 ring-emerald-100">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['perOrder', '每单 (¥)'],
                    ['perUnit', '每件 (¥)'],
                    ['minCharge', '最低 (¥)'],
                  ] as const).map(([key, label]) => (
                    <FormField key={key} label={label}>
                      <input
                        type="number"
                        step="0.01"
                        className={formInput()}
                        value={pickupRule[key]}
                        onChange={e => setPriceDraft(p => ({
                          ...p,
                          pickupByRegion: {
                            [activeRegion]: { ...pickupRule, [key]: Number(e.target.value) },
                          },
                        }))}
                      />
                    </FormField>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">仓租模板</h2>
              <p className="mt-0.5 text-[11px] text-text-muted">仓库 {storageDraft.warehouseId} · 更新 {storageDraft.updatedAt}</p>
            </div>
            <Badge status="active" label={storageDraft.status === 'active' ? '生效中' : '草稿'} />
          </div>

          <div className="space-y-4">
            <FormField label="模板名称">
              <input
                className={formInput()}
                value={storageDraft.name}
                onChange={e => setStorageDraft(s => ({ ...s, name: e.target.value }))}
              />
            </FormField>

            <FormField label="计费维度">
              <select
                className={formSelect()}
                value={storageDraft.billingUnit}
                onChange={e => setStorageDraft(s => ({
                  ...s,
                  billingUnit: e.target.value as 'volume' | 'piece',
                }))}
              >
                <option value="volume">按体积 (m³/天)</option>
                <option value="piece">按件数 (件/天)</option>
              </select>
            </FormField>

            <div className="grid grid-cols-2 gap-2">
              {storageDraft.billingUnit === 'volume' ? (
                <FormField label="仓租单价 (¥/m³/天)">
                  <input
                    type="number"
                    step="0.01"
                    className={formInput()}
                    value={storageDraft.pricePerCbmPerDay}
                    onChange={e => setStorageDraft(s => ({ ...s, pricePerCbmPerDay: Number(e.target.value) }))}
                  />
                </FormField>
              ) : (
                <FormField label="仓租单价 (¥/件/天)">
                  <input
                    type="number"
                    step="0.01"
                    className={formInput()}
                    value={storageDraft.pricePerPiecePerDay}
                    onChange={e => setStorageDraft(s => ({ ...s, pricePerPiecePerDay: Number(e.target.value) }))}
                  />
                </FormField>
              )}
              <FormField label="每日最低收费 (¥)">
                <input
                  type="number"
                  className={formInput()}
                  value={storageDraft.minChargePerDay}
                  onChange={e => setStorageDraft(s => ({ ...s, minChargePerDay: Number(e.target.value) }))}
                />
              </FormField>
              <FormField label="免租期 (天)" className="col-span-2">
                <input
                  type="number"
                  className={formInput()}
                  value={storageDraft.freeStorageDays}
                  onChange={e => setStorageDraft(s => ({ ...s, freeStorageDays: Number(e.target.value) }))}
                />
              </FormField>
            </div>

            <div className="rounded-lg bg-indigo-50 p-3 ring-1 ring-indigo-100">
              <p className="text-xs font-semibold text-indigo-900">客户绑定说明</p>
              <ul className="mt-2 space-y-1 text-[11px] text-indigo-800">
                <li>· 在「账号管理」中为每个客户分别选择 JHB / CPT / DBN 的价格模板</li>
                <li>· 发往 CPT 的单据使用 CPT 模板，与 JHB、DBN 互不影响</li>
                <li>· 未绑定的地区将使用该地区的默认生效模板</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
