import { describe, expect, it } from 'vitest'
import { failureNotice } from './failureNotice'

describe('failure notices', () => {
  it('automatically dismisses errors and groups identical notices', () => {
    expect(failureNotice('库存不足，请减少数量后继续')).toMatchObject({
      message: '库存不足，请减少数量后继续',
      duration: 5000,
      showClose: true,
      grouping: true,
      customClass: 'erp-failure-notice',
    })
  })

  it('preserves a positive duration and additional CSS classes', () => {
    expect(failureNotice({ message: '请返回列表核对', duration: 3000, customClass: 'extra' })).toMatchObject({
      message: '请返回列表核对',
      duration: 3000,
      showClose: true,
      customClass: 'erp-failure-notice extra',
    })
  })

  it.each([0, -1, Infinity, NaN])('uses the default for invalid or persistent duration %s', (duration) => {
    expect(failureNotice({ message: '操作失败', duration }).duration).toBe(5000)
  })
})
