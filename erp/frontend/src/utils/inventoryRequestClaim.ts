export class InventoryClaimConflict extends Error {}
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type InventoryClaimLock = (name: string, prepare: () => boolean) => Promise<boolean>

const browserLock: InventoryClaimLock = async (name, prepare) => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('当前浏览器无法协调多个库存页面，本次尚未提交，请使用支持安全标签页锁的浏览器后重试')
  return navigator.locks.request(name, () => prepare())
}

/** Keep local creation atomic across tabs; the network request runs after the claim is released. */
export async function claimInventoryRequest(options: {
  actor: string; storage: StoragePort; current: () => boolean; prepare: () => boolean
  lock?: InventoryClaimLock
}): Promise<boolean> {
  const { actor, storage } = options
  const epochKey = `erp.inventory.claim.${actor}`
  const observed = storage.getItem(epochKey)
  return (options.lock || browserLock)(`erp.inventory.original.${actor}`, () => {
    if (!options.current()) return false
    if (storage.getItem(epochKey) !== observed) throw new InventoryClaimConflict('另一库存页面已发起操作，请核对该页面的原请求后再继续')
    const paths = [
      [`erp.inventory.change.${actor}`, '库存查询页面'],
      [`erp.inventory.adjust.${actor}`, '库存查询页面'],
      [`erp.logistics.transfer.${actor}`, '中转仓库存页面'],
    ]
    for (const [key, page] of paths) {
      if (storage.getItem(key)) throw new InventoryClaimConflict(`已有库存原请求待核对，请到${page}继续原操作`)
    }
    const epoch = crypto.randomUUID()
    storage.setItem(epochKey, epoch)
    if (storage.getItem(epochKey) !== epoch) throw new Error('库存页面协调信息无法保存，本次尚未提交')
    return options.prepare()
  })
}
