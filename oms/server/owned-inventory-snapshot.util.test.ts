import test from 'node:test'
import assert from 'node:assert/strict'
import { ownedInventorySnapshot } from './owned-inventory-snapshot.util.js'

test('missing outbound snapshot does not become zero inventory', () => {
  assert.equal(ownedInventorySnapshot({}), null)
  assert.equal(ownedInventorySnapshot({ availableQty: 8 }), null)
  assert.equal(ownedInventorySnapshot({ lockedQty: 2 }), null)
})

test('cancellation uses absolute ERP quantities and preserves goods awaiting shelving', () => {
  assert.deepEqual(ownedInventorySnapshot({ availableQty: 12, lockedQty: 3 }, 5), {
    available: 12, locked: 3, pendingShelving: 5,
  })
})

test('explicit zero inventory and shelving quantities remain valid', () => {
  assert.deepEqual(ownedInventorySnapshot({ availableQty: 0, lockedQty: 0, pendingShelvingQty: 0 }, 5), {
    available: 0, locked: 0, pendingShelving: 0,
  })
})

test('invalid quantities do not overwrite customer inventory', () => {
  for (const qty of [null, undefined, '', ' ', -1, 1.5, NaN, Infinity, true]) {
    assert.equal(ownedInventorySnapshot({ availableQty: qty, lockedQty: 2 }), null)
    assert.equal(ownedInventorySnapshot({ availableQty: 8, lockedQty: qty }), null)
  }
})
