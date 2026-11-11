import { describe, expect, it } from 'vitest'
import { persistentFailureNotice } from './failureNotice'

describe('persistent failure notices', () => {
  it('keeps a text failure until the user closes it', () => {
    expect(persistentFailureNotice('库存不足，请减少数量后继续')).toMatchObject({
      message: '库存不足，请减少数量后继续',
      duration: 0,
      showClose: true,
      customClass: 'erp-failure-notice',
    })
  })

  it('does not let a short duration hide an existing failure', () => {
    expect(persistentFailureNotice({ message: '请返回列表核对', duration: 3000, customClass: 'extra' })).toMatchObject({
      message: '请返回列表核对',
      duration: 0,
      showClose: true,
      customClass: 'erp-failure-notice extra',
    })
  })
})
