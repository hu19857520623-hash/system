export const PRODUCT_ACTIONS = ['approve', 'discard', 'restore'] as const
export type ProductAction = typeof PRODUCT_ACTIONS[number]
export const productActionLabels: Record<ProductAction, string> = { approve: '审核商品', discard: '废弃商品', restore: '恢复商品' }
export type ProductActionItem = { id: string; customerId: string; expected: string }
export type ProductActionReceipt = { requestId: string; status: 'unknown' | 'confirmed' | 'cancelled'; action?: ProductAction; productIds?: string[] }
