import { describe, expect, it, vi } from 'vitest'
import { loadWarehouseOrderChoices } from './warehouseOrderChoices'
const row = (id: number, extra = {}) => ({ id, inboundNo: `RV-${id}`, warehouseCode: 'JHB', status: 'receiving', ...extra })
describe('完整读取仓库可作业入库单', () => {
  it('超过5000张仍可选择最早的单据，始终使用当前仓库的专用分页接口', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(5001 - i))
    const api = { listWorkOrders: vi.fn(async ({ page, pageSize }) => ({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length })) }
    expect((await loadWarehouseOrderChoices(api, 'JHB'))?.map(r => r.id)).toEqual(rows.map(r => r.id))
    expect(api.listWorkOrders).toHaveBeenCalledTimes(26)
    expect(api.listWorkOrders).toHaveBeenNthCalledWith(26, { warehouseCode: 'JHB', page: 26, pageSize: 200 })
  })
  it('过滤OMS只读快照、其它仓库和已完结单', async () => {
    const api = { listWorkOrders: vi.fn(async () => ({ items: [row(1), row(2, { warehouseCode: 'DBN' }), row(3, { readOnly: true }), row(4, { status: 'completed' })], total: 4 })) }
    expect(await loadWarehouseOrderChoices(api, 'JHB')).toEqual([row(1)])
  })
  it('后续页失败时整次失败，不把第一页当成完整列表', async () => {
    const api = { listWorkOrders: vi.fn(async ({ page }) => { if (page === 2) throw new Error('连接中断'); return { items: [row(2)], total: 2 } }) }
    await expect(loadWarehouseOrderChoices(api, 'JHB')).rejects.toThrow('连接中断')
  })
  it.each(['changed-total', 'duplicate', 'empty-page'] as const)('分页%s不发布遗漏或重复的选择', async scenario => {
    const api = { listWorkOrders: vi.fn(async ({ page }) => page === 1 ? { items: [row(2)], total: 2 } : { items: scenario === 'empty-page' ? [] : [row(2)], total: scenario === 'changed-total' ? 3 : 2 }) }
    await expect(loadWarehouseOrderChoices(api, 'JHB')).rejects.toThrow(/刷新|读取/)
  })
  it('切换仓库后放弃旧读取，不再请求旧范围的后续页', async () => {
    let current = true
    const api = { listWorkOrders: vi.fn(async () => { current = false; return { items: [row(1)], total: 301 } }) }
    expect(await loadWarehouseOrderChoices(api, 'JHB', () => current)).toBeNull(); expect(api.listWorkOrders).toHaveBeenCalledOnce()
  })
  it('空仓返回空列表，无效总数不能被当作没有作业', async () => {
    expect(await loadWarehouseOrderChoices({ listWorkOrders: async () => ({ items: [], total: 0 }) }, 'JHB')).toEqual([])
    await expect(loadWarehouseOrderChoices({ listWorkOrders: async () => ({ items: [], total: '0' }) }, 'JHB')).rejects.toThrow('读取不完整')
  })
})
