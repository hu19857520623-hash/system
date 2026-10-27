import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import { purchaseApi } from '@/api/client.js'
import { pickFile } from '@/composables/useAsyncIo'
import { downloadCsv } from '@/utils/csv'
import { usePrePurchaseInfo } from './usePrePurchaseInfo'

vi.mock('element-plus', () => ({ ElMessage: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/api/client.js', () => ({ purchaseApi: { exportPrePoInfo: vi.fn(), importPrePoInfo: vi.fn() } }))
vi.mock('@/composables/useAsyncIo', () => ({ pickFile: vi.fn() }))
vi.mock('@/utils/csv', () => ({ downloadCsv: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pickFile).mockResolvedValue({ text: async () => 'CSV内容' } as File)
})

describe('预采购勾选导出和错误明细交互', () => {
  it('未勾选时不调用导出接口', async () => {
    const state = usePrePurchaseInfo(vi.fn())
    await state.exportInfo()
    expect(purchaseApi.exportPrePoInfo).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('先勾选'))
  })

  it('仅发送选中的单据 ID，并保留必填说明行下载', async () => {
    const state = usePrePurchaseInfo(vi.fn())
    state.selected.value = [{ id: 1 }, { id: 3 }]
    const result = { total: 2, headers: ['预采购单号（必填）'], rows: [['填写说明'], ['PRE-1'], ['PRE-3']] }
    vi.mocked(purchaseApi.exportPrePoInfo).mockResolvedValue(result)
    await state.exportInfo()
    expect(purchaseApi.exportPrePoInfo).toHaveBeenCalledWith([1, 3])
    expect(downloadCsv).toHaveBeenCalledWith(expect.stringContaining('预采购单信息_'), result.headers, result.rows)
    expect(state.busy.value).toBe(false)
  })

  it('上传后多字段错误显示在持久弹窗中，可下载完整行号、字段、值和原因', async () => {
    const reload = vi.fn(), state = usePrePurchaseInfo(reload)
    const failures = [
      { lineNo: 3, prePoNo: 'PRE-1', field: '单价', value: '-1', reason: '必须大于零' },
      { lineNo: 3, prePoNo: 'PRE-1', field: '供应商', value: '', reason: '必填，不能为空' },
      { lineNo: 4, prePoNo: 'PRE-2', field: '计划数量', value: '1.5', reason: '须为整数' },
    ]
    vi.mocked(purchaseApi.importPrePoInfo).mockResolvedValue({ updated: 0, failed: 2, failures })
    await state.importInfo()
    expect(state.failureVisible.value).toBe(true)
    expect(state.failedRows.value).toBe(2)
    expect(state.failures.value).toEqual(failures)
    expect(reload).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
    state.downloadFailures()
    expect(downloadCsv).toHaveBeenCalledWith(expect.any(String), ['行号', '预采购单号', '字段', '填写值', '错误原因'], failures.map(row => [row.lineNo, row.prePoNo, row.field, row.value, row.reason]))
  })

  it('修正后重新上传成功，清除上次错误并刷新列表', async () => {
    const reload = vi.fn().mockResolvedValue(undefined), state = usePrePurchaseInfo(reload)
    state.failureVisible.value = true
    state.failures.value = [{ lineNo: 3, prePoNo: 'PRE-1', field: '单价', value: '', reason: '必填' }]
    vi.mocked(purchaseApi.importPrePoInfo).mockResolvedValue({ updated: 3, failed: 0, failures: [] })
    await state.importInfo()
    expect(reload).toHaveBeenCalledOnce()
    expect(state.failures.value).toEqual([])
    expect(state.failureVisible.value).toBe(false)
    expect(ElMessage.success).toHaveBeenCalledWith(expect.stringContaining('3 张'))
  })

  it('取消选择文件不提交请求，并恢复按钮', async () => {
    const state = usePrePurchaseInfo(vi.fn())
    vi.mocked(pickFile).mockResolvedValue(null)
    await state.importInfo()
    expect(purchaseApi.importPrePoInfo).not.toHaveBeenCalled()
    expect(state.busy.value).toBe(false)
  })

  it('网络中断明确提示核对结果，避免误报未写入', async () => {
    const state = usePrePurchaseInfo(vi.fn())
    vi.mocked(purchaseApi.importPrePoInfo).mockRejectedValue(new Error('网络中断'))
    await state.importInfo()
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('结果暂无法确认'))
    expect(state.busy.value).toBe(false)
  })
})
