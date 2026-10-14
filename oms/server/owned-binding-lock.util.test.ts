import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertOwnedBindingMutation, OwnedBindingLockedError } from './owned-binding-lock.util.js'
const base = { id: 'a', customerId: 'customer-1', stockSource: 'owned', platform: 'Takealot', platformBarcode: '9901111111111', status: 'active', lines: [{ internalSku: 'CUSTOMER-SKU', qty: 1 }] }
const stocked = { $queryRawUnsafe: async <T>() => [{ present: 1 }] as T }
const empty = { $queryRawUnsafe: async <T>() => [] as T }
test('stock locks barcode, SKU, quantity, source, status and delete; unchanged snapshot remains valid', async () => {
  await assertOwnedBindingMutation(stocked, base, { ...base }, [base])
  for (const change of [{ platformBarcode: '9902222222222' }, { lines: [{ internalSku: 'OTHER' }] }, { stockSource: 'catalog' }, { status: 'deprecated' }, { lines: [{ internalSku: 'CUSTOMER-SKU', qty: 2 }] }]) {
    await assert.rejects(assertOwnedBindingMutation(stocked, base, { ...base, ...change }, [base]), OwnedBindingLockedError)
  }
  await assert.rejects(assertOwnedBindingMutation(stocked, base, undefined, [base]), OwnedBindingLockedError)
})
test('new record cannot add alternate barcode for stocked owned SKU', async () => {
  await assert.rejects(assertOwnedBindingMutation(stocked, undefined, { ...base, id: 'b', platformBarcode: '9902222222222', stockSource: 'catalog' }, [base]), OwnedBindingLockedError)
})
test('first binding, zero stock, other customer and catalog remain editable', async () => {
  await assertOwnedBindingMutation(stocked, undefined, base, [])
  await assertOwnedBindingMutation(empty, base, { ...base, platformBarcode: '9902222222222' }, [base])
  await assertOwnedBindingMutation(stocked, undefined, { ...base, id: 'b', customerId: 'customer-2', platformBarcode: '9902222222222' }, [base])
  const catalog = { ...base, stockSource: 'catalog' }
  await assertOwnedBindingMutation(stocked, catalog, { ...catalog, platformBarcode: '9902222222222' }, [catalog])
})
