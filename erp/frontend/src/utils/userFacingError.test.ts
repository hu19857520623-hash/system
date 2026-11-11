import { describe, it, expect } from 'vitest'
import { userFacingError } from '@erp/shared/user-facing-error'
describe('ERP 通用错误完整中文化', () => {
  it.each(['Resource not found', 'RESOURCE NOT FOUND.', 'Record not found', 'Document not found', 'Entity not found', 'Resource 未找到所需记录'])('整体翻译并支持再次处理 %s', error => {
    const result = userFacingError(error, 404)
    expect(result).toBe('未找到所需记录，请刷新后重试');expect(userFacingError(result, 404)).toBe(result)
  })
  it('保留中文继续路径和合法的商品、单据标识', () => {
    expect(userFacingError('读取原单失败：Resource not found', 404)).toBe('读取原单失败：未找到所需记录，请刷新后重试')
    const business = 'SKU Resource-01 缺少 2 件，请核对入库单 RV-81'
    expect(userFacingError(business, 400)).toBe(business)
  })
  it.each(['Invalid `prisma.inboundOrder.update()` invocation', 'SQLSTATE 45000 isolated fault', 'ECONNRESET 127.0.0.1:3000', '<html>Bad Gateway</html>'])('隐藏技术详情并保留已保存的恢复说明 %s', raw => {
    expect(userFacingError(`原单已保存，同步失败：${raw}`, 503)).toBe('原单已保存，同步失败：服务暂时不可用，请稍后重试')
  })
})
