import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogBindingSkus, catalogMappingSource } from './catalog-binding.util.js'

test('ERP catalog SKU identities force catalog bindings without treating the 990 as an ERP identifier', async () => {
  const db = { $queryRawUnsafe: async <T>() => [{ sku: 'TKL-SHARED' }, { sku: 'FUR-LVR-SID-011' }] as T }
  const skus = await catalogBindingSkus(db)
  assert.equal(catalogMappingSource([{ internalSku: 'SHARED' }], skus, 'owned'), 'catalog')
  assert.equal(catalogMappingSource([{ internalSku: 'FUR-LVR-SID-011' }], skus, 'owned'), 'catalog')
  assert.equal(catalogMappingSource([{ internalSku: 'TKL005-710672' }], skus, 'owned'), 'owned')
})
