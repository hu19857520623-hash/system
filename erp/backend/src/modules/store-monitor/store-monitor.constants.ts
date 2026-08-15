/** 陪跑1 负责店铺槽位 1-5；陪跑2 负责 6-9 与 0 */
export const COACH1_SLOTS = [1, 2, 3, 4, 5] as const
export const COACH2_SLOTS = [0, 6, 7, 8, 9] as const

export const ALL_STORE_SLOTS = [...COACH1_SLOTS, ...COACH2_SLOTS].sort((a, b) => a - b)

export function coachRoleForSlot(slot: number): 'coach1' | 'coach2' | null {
  if ((COACH1_SLOTS as readonly number[]).includes(slot)) return 'coach1'
  if ((COACH2_SLOTS as readonly number[]).includes(slot)) return 'coach2'
  return null
}

export function coachLabel(role: string) {
  if (role === 'coach1') return '陪跑1'
  if (role === 'coach2') return '陪跑2'
  return role
}
