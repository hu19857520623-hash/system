import { describe, expect, it, vi } from 'vitest'
import { LEADS_IMPORT_FIELDS } from '@/constants/importTemplates.ts'
import { downloadRequiredFieldsExcel } from './csv'

describe('预采购必填单元格颜色导出', () => {
  it('只输出表头和所选单据，必填列所有格子标红，保留文字和多行内容', async () => {
    let exported!: Blob
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      downloadRequiredFieldsExcel('预采购单信息.xls', ['预采购单号（必填）', '备注'], [['PRE-1', '<备注>\n下一行'], ['PRE-3', '']])
      const html = await exported.text()
      expect(anchor.download).toBe('预采购单信息.xls')
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(html.match(/<tr>/g)).toHaveLength(3)
      expect(html.match(/background-color:#ffc7ce/g)).toHaveLength(3)
      expect(html.match(/background-color:#ffffff/g)).toHaveLength(3)
      expect(html).toContain('&lt;备注&gt;\n下一行')
      expect(html).toContain('PRE-1')
      expect(html).toContain('PRE-3')
      expect(html).not.toContain('填写说明')
      expect(revoke).toHaveBeenCalledWith('blob:test')
    } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals() }
  })
})

describe('lead import template channel note', () => {
  it('lists the selectable sources, including 视频号', () => {
    const source = LEADS_IMPORT_FIELDS.find((field) => field.key === 'source')
    expect(source?.hint).toContain('留空默认 Takealot')
    expect(source?.hint).toContain('Takealot、官网、展会、推荐、小红书、抖音、视频号、公众号、其他')
  })
})
