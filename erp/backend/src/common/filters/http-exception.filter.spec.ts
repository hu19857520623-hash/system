import { BadRequestException, HttpException, Logger } from '@nestjs/common'
import { HttpExceptionFilter } from './http-exception.filter'
import { userFacingError } from '@erp/shared/user-facing-error'

describe('Chinese user-facing API failures', () => {
  it.each([
    ['Failed to fetch', 0, '网络连接失败'], ['NetworkError when attempting to fetch resource', 0, '网络连接失败'],
    ['Unauthorized', 401, '登录已失效'], ['Forbidden', 403, '没有权限'], ['Not Found', 404, '未找到'],
    ['Internal Server Error', 500, '服务处理失败'], ['<html>Bad Gateway</html>', 502, '服务暂时无法连接'],
    ['sku must be a string', 400, '输入信息有误'], ['quantity must not be less than 1', 400, '输入信息有误'],
    ['Unexpected token < in JSON at position 0', 0, '数据处理失败'], ['Cannot read properties of undefined', 0, '数据处理失败'],
    ['Database unavailable', 500, '服务处理失败'], ['操作失败：PrismaClientKnownRequestError', 500, '服务处理失败'],
  ])('normalizes %s without exposing English diagnostics', (raw, status, expected) => {
    expect(userFacingError(raw, Number(status))).toContain(expected)
  })

  it('preserves Chinese business details including identifiers', () => {
    const message = 'SKU FUR-LVR-SID-011 可用 2 件，不足发运 9 件'
    expect(userFacingError(message, 400)).toBe(message)
    expect(userFacingError({ message: ['请填写客户代码', '收回数量须大于 0'] }, 400)).toBe('请填写客户代码；收回数量须大于 0')
  })

  it.each([new BadRequestException(['sku must be a string', '请填写仓库']), new HttpException('Unauthorized', 401), new Error('Database password=PRIVATE_TEST')])(
    'keeps the status code and prevents raw runtime errors from reaching the client', exception => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
      const json = jest.fn()
      const response = { status: jest.fn().mockReturnValue({ json }) }
      const host = { switchToHttp: () => ({ getResponse: () => response }) }
      new HttpExceptionFilter().catch(exception, host as any)
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/[\u3400-\u9fff]/), data: null }))
      expect(JSON.stringify(json.mock.calls)).not.toContain('PRIVATE_TEST')
      log.mockRestore()
    },
  )
})
