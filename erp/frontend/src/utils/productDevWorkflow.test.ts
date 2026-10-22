import { describe, expect, it, vi } from 'vitest'
import { saveAndSubmitProductDev } from './productDevWorkflow'

describe('选品申请的保存与继续提交', () => {
  it('创建已确认但提交被拒绝时，保留编号，修改后继续同一草稿', async () => {
    let id: number | null = null
    const api = { create: vi.fn().mockResolvedValue({ id: 17 }), update: vi.fn().mockResolvedValue({}), submit: vi.fn().mockRejectedValueOnce(new Error('请上传售价图')).mockResolvedValueOnce({ status: 'submitted' }) }
    await expect(saveAndSubmitProductDev(api, id, { sku: 'AUDIT-A', estimatedCost: 0 }, value => { id = value })).rejects.toThrow('请上传售价图')
    expect(id).toBe(17)
    await saveAndSubmitProductDev(api, id, { sku: 'AUDIT-A', estimatedCost: 0 }, value => { id = value })
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.update).toHaveBeenCalledWith(17, { sku: 'AUDIT-A', estimatedCost: 0 })
    expect(api.submit.mock.calls).toEqual([[17], [17]])
  })

  it('草稿创建未确认时不会发送提交或伪造已保存编号', async () => {
    const api = { create: vi.fn().mockRejectedValue(new Error('网络连接失败')), update: vi.fn(), submit: vi.fn() }
    const confirmed = vi.fn()
    await expect(saveAndSubmitProductDev(api, null, {}, confirmed)).rejects.toThrow('网络连接失败')
    expect(api.submit).not.toHaveBeenCalled()
    expect(confirmed).not.toHaveBeenCalled()
  })

  it('已有草稿保存失败时不继续提交旧资料', async () => {
    const api = { create: vi.fn(), update: vi.fn().mockRejectedValue(new Error('SKU 重复')), submit: vi.fn() }
    await expect(saveAndSubmitProductDev(api, 17, {}, vi.fn())).rejects.toThrow('SKU 重复')
    expect(api.submit).not.toHaveBeenCalled()
  })
})
