import { RedisJsonCache } from './redis-json-cache.js'
import { fetchErpTakealotFulfillmentWarehouses } from './erpClient.js'

export const applicationCache = new RedisJsonCache(process.env)

export function cachedFulfillmentWarehouses() {
  return applicationCache.remember('takealot-dest', 'oms:takealot-dest:fulfillment', 30,
    () => fetchErpTakealotFulfillmentWarehouses())
}
