import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerBrowserDownload } from './client.js'

describe('browser file downloads', () => {
  const anchor = { href: '', download: '', rel: '', style: { display: '' }, click: vi.fn() }
  const open = vi.fn(() => null)
  const appendChild = vi.fn()
  const removeChild = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('window', { open, setTimeout })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild, removeChild },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-file')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['product_labels_GQCL_JHB_071.pdf', 'application/pdf'],
    ['shipment-pod.pdf', 'application/octet-stream'],
    ['export.csv', 'text/csv'],
    ['商品标签.pdf', 'application/pdf'],
  ])('downloads %s once with its supplied filename', (name, type) => {
    expect(triggerBrowserDownload(new Blob(['file content'], { type }), name)).toBe('download')
    expect(open).not.toHaveBeenCalled()
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe(name)
    expect(anchor.href).toBe('blob:test-file')
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(removeChild).toHaveBeenCalledWith(anchor)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-file')
  })

  it('rejects empty files without opening or downloading anything', () => {
    expect(() => triggerBrowserDownload(new Blob([]), 'empty.pdf')).toThrow('文件内容为空')
    expect(open).not.toHaveBeenCalled()
    expect(anchor.click).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
