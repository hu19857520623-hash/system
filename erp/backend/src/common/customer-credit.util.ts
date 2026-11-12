/** Negative balance records debt; credit is a spending ceiling, never a recharge. */
export function customerCredit(customer: { balance: unknown; creditLimit?: unknown }) {
  const balance = Math.round(Number(customer.balance) * 100)
  const limit = Math.round(Number(customer.creditLimit ?? 0) * 100)
  return { creditLimit: limit / 100, usedCredit: Math.max(0, -balance) / 100,
    remainingCredit: Math.max(0, limit - Math.max(0, -balance)) / 100,
    availableBalance: (balance + limit) / 100 }
}
