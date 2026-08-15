import { useSyncExternalStore } from 'react'
import { apiDelete, apiPut } from '../api/client'
import { getAccountsSnapshot } from '../auth/accountStore'
import {
  DEFAULT_PRICE_TEMPLATE,
  DEFAULT_PRICE_TEMPLATES,
  DEFAULT_STORAGE_TEMPLATE,
  DEFAULT_REGION_DISPATCH_RULES,
  normalizePriceTemplate,
  normalizeRegionDispatchRules,
  syncPriceTemplateRegions,
  resolveCustomerPriceTemplateBindings,
  inferTemplateRegionCode,
  type PriceTemplate,
  type StorageRentTemplate,
  type RegionDispatchRule,
} from './feeTemplates'

interface TemplateState {
  priceTemplates: PriceTemplate[]
  storageTemplate: StorageRentTemplate
  regionDispatchRules: RegionDispatchRule[]
}

let state: TemplateState = {
  priceTemplates: DEFAULT_PRICE_TEMPLATES.map(t => ({ ...t })),
  storageTemplate: { ...DEFAULT_STORAGE_TEMPLATE },
  regionDispatchRules: DEFAULT_REGION_DISPATCH_RULES.map(r => ({ ...r })),
}
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function syncAllTemplatesWithRegions(templates: PriceTemplate[], rules: RegionDispatchRule[]): PriceTemplate[] {
  return templates.map(t => syncPriceTemplateRegions(t, rules))
}

function persist(next: TemplateState) {
  state = next
  emit()
  void apiPut('/fee-templates', next).catch(err => console.error('persist fee templates failed', err))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function hydrateFeeTemplates(input: {
  priceTemplate?: PriceTemplate | null
  priceTemplates?: PriceTemplate[] | null
  storageTemplate: StorageRentTemplate | null
  regionDispatchRules: RegionDispatchRule[]
}) {
  const regionDispatchRules = input.regionDispatchRules?.length
    ? normalizeRegionDispatchRules(input.regionDispatchRules)
    : DEFAULT_REGION_DISPATCH_RULES.map(r => ({ ...r }))

  const rawTemplates = input.priceTemplates?.length
    ? input.priceTemplates
    : input.priceTemplate
      ? [input.priceTemplate]
      : DEFAULT_PRICE_TEMPLATES

  const priceTemplates = syncAllTemplatesWithRegions(
    rawTemplates.map(t => syncPriceTemplateRegions(normalizePriceTemplate(t), regionDispatchRules)),
    regionDispatchRules,
  )

  state = {
    priceTemplates,
    storageTemplate: { ...DEFAULT_STORAGE_TEMPLATE, ...(input.storageTemplate ?? {}) },
    regionDispatchRules,
  }
  emit()
}

export function useFeeTemplates() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getPriceTemplates(): PriceTemplate[] {
  return state.priceTemplates
}

export function getActivePriceTemplate(): PriceTemplate {
  return state.priceTemplates.find(t => t.status === 'active') ?? state.priceTemplates[0] ?? DEFAULT_PRICE_TEMPLATE
}

export function getPriceTemplatesForRegion(regionCode: string): PriceTemplate[] {
  const code = regionCode.toLowerCase()
  return state.priceTemplates.filter(t => inferTemplateRegionCode(t) === code)
}

export function getDefaultTemplateForRegion(regionCode: string): PriceTemplate {
  const code = regionCode.toLowerCase()
  const active = state.priceTemplates.find(t => inferTemplateRegionCode(t) === code && t.status === 'active')
  if (active) return active
  const any = state.priceTemplates.find(t => inferTemplateRegionCode(t) === code)
  if (any) return any
  return syncPriceTemplateRegions(
    { ...DEFAULT_PRICE_TEMPLATE, id: `pt-${code}-fallback`, regionCode: code },
    state.regionDispatchRules,
  )
}

export function getPriceTemplateForCustomer(
  customerId?: string | null,
  destRegion?: string | null,
): PriceTemplate {
  const region = (destRegion ?? 'jhb').toLowerCase()
  if (customerId) {
    const acc = getAccountsSnapshot().find(a => a.id === customerId)
    if (acc) {
      const bindings = resolveCustomerPriceTemplateBindings(
        acc.priceTemplateByRegion,
        acc.priceTemplateId,
      )
      const templateId = bindings[region]
      if (templateId) {
        const tpl = state.priceTemplates.find(t => t.id === templateId)
        if (tpl) return tpl
      }
    }
  }
  return getDefaultTemplateForRegion(region)
}

export function getPriceTemplateById(id: string): PriceTemplate | undefined {
  return state.priceTemplates.find(t => t.id === id)
}

export function getActiveStorageTemplate(): StorageRentTemplate {
  return state.storageTemplate
}

export function getRegionDispatchRules(): RegionDispatchRule[] {
  return state.regionDispatchRules
}

export function updatePriceTemplates(templates: PriceTemplate[]) {
  const synced = syncAllTemplatesWithRegions(templates, state.regionDispatchRules)
  persist({
    ...state,
    priceTemplates: synced.map(t => ({
      ...t,
      updatedAt: new Date().toISOString().slice(0, 10),
    })),
  })
}

export function updatePriceTemplate(id: string, patch: Partial<PriceTemplate>) {
  updatePriceTemplates(
    state.priceTemplates.map(t => t.id === id
      ? { ...t, ...patch, updatedAt: new Date().toISOString().slice(0, 10) }
      : t),
  )
}

export function addPriceTemplate(template: PriceTemplate) {
  const synced = syncPriceTemplateRegions(template, state.regionDispatchRules)
  updatePriceTemplates([...state.priceTemplates, synced])
}

export function removePriceTemplate(id: string) {
  const target = state.priceTemplates.find(t => t.id === id)
  if (!target) return
  const code = inferTemplateRegionCode(target)
  const sameRegionCount = state.priceTemplates.filter(t => inferTemplateRegionCode(t) === code).length
  if (sameRegionCount <= 1) return
  void apiDelete(`/fee-templates/price/${encodeURIComponent(id)}`).catch(err =>
    console.error('delete price template failed', err),
  )
  updatePriceTemplates(state.priceTemplates.filter(t => t.id !== id))
}

export function updateStorageTemplate(patch: Partial<StorageRentTemplate>) {
  persist({
    ...state,
    storageTemplate: {
      ...state.storageTemplate,
      ...patch,
      updatedAt: new Date().toISOString().slice(0, 10),
    },
  })
}

export function updateRegionDispatchRules(rules: RegionDispatchRule[]) {
  const normalized = normalizeRegionDispatchRules(rules)
  const nextIds = new Set(normalized.map(rule => rule.id))
  const removedIds = state.regionDispatchRules.filter(rule => !nextIds.has(rule.id)).map(rule => rule.id)
  for (const id of removedIds) {
    void apiDelete(`/fee-templates/region/${encodeURIComponent(id)}`).catch(err =>
      console.error('delete region rule failed', err),
    )
  }
  persist({
    ...state,
    regionDispatchRules: normalized,
    priceTemplates: syncAllTemplatesWithRegions(
      state.priceTemplates.map(t => ({ ...t, updatedAt: new Date().toISOString().slice(0, 10) })),
      normalized,
    ),
  })
}

export function updateRegionDispatchRule(id: string, patch: Partial<RegionDispatchRule>) {
  updateRegionDispatchRules(
    state.regionDispatchRules.map(r => (r.id === id ? { ...r, ...patch } : r)),
  )
}
