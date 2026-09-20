import { FULFILLMENT_WAREHOUSES, type FulfillmentWarehouse } from './mockData'
import { getErpFulfillmentWarehouses } from '../api/erp'

let cached: FulfillmentWarehouse[] = [...FULFILLMENT_WAREHOUSES]
let loaded = false
let inflight: Promise<FulfillmentWarehouse[]> | null = null

export function getFulfillmentWarehouses(): FulfillmentWarehouse[] {
  return cached
}

export function fulfillmentWarehousesLoaded(): boolean {
  return loaded
}

/** 从 ERP Takealot 目的仓配置拉取 OMS 履约仓下拉；失败时保留静态兜底 */
export function hydrateFulfillmentWarehouses(
  items: { id: string; city: string }[] | undefined | null,
) {
  if (items?.length) {
    cached = items.map((row) => ({ id: row.id, city: row.city }))
    loaded = true
  }
}

export async function loadFulfillmentWarehousesFromErp(force = false): Promise<FulfillmentWarehouse[]> {
  if (!force && loaded) return cached
  if (inflight) return inflight
  inflight = getErpFulfillmentWarehouses()
    .then((res) => {
      hydrateFulfillmentWarehouses(res.items)
      return cached
    })
    .catch(() => cached)
    .finally(() => {
      inflight = null
    })
  return inflight
}
