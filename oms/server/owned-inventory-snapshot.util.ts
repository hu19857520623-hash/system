function stockQuantity(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const qty = Number(value)
  return Number.isSafeInteger(qty) && qty >= 0 ? qty : null
}

/** Only explicit ERP quantities can replace the customer's inventory mirror. */
export function ownedInventorySnapshot(
  line: { availableQty?: unknown; lockedQty?: unknown; pendingShelvingQty?: unknown },
  currentPendingShelving = 0,
) {
  const available = stockQuantity(line.availableQty)
  const locked = stockQuantity(line.lockedQty)
  if (available === null || locked === null) return null
  return {
    available,
    locked,
    pendingShelving: stockQuantity(line.pendingShelvingQty) ?? currentPendingShelving,
  }
}
