import { describe, expect, it } from 'vitest'
import { attachmentUploadFailure, imageUploadFailure, pendingActionNotice, requestStillPending } from './requestRecovery'

describe('登录失效和请求频繁时保留原操作', () => {
  it('401、403、429 和网络故障仍待核对，明确校验失败可以重新填写', () => {
    for (const status of [Number.NaN, 0, 401, 403, 408, 409, 429, 500]) expect(requestStillPending(status)).toBe(true)
    for (const status of [400, 404, 422]) expect(requestStillPending(status)).toBe(false)
  })

  it('登录失效、岗位变化和请求频繁使用中文，不要求重复提交', () => {
    expect(pendingActionNotice(401, '采购操作')).toContain('重新登录')
    expect(pendingActionNotice(403, '收费模板')).toContain('原岗位权限')
    expect(pendingActionNotice(429, '预采购')).toContain('不要重复提交')
    expect(pendingActionNotice(400, '采购操作')).toBe('')
  })

  it('附件上传在登录失效时保留同一个文件，校验失败才允许重选', () => {
    expect(attachmentUploadFailure(401, 'Unauthorized').clear).toBe(false)
    expect(attachmentUploadFailure(401, 'Unauthorized').text).toContain('同一个文件')
    expect(attachmentUploadFailure(403, 'Forbidden').text).toContain('原岗位权限')
    expect(attachmentUploadFailure(429, 'Too Many Requests').text).toContain('不要另选')
    expect(attachmentUploadFailure(409, '原附件内容不同，不要修改后重试').mismatch).toBe(true)
    expect(attachmentUploadFailure(400, '附件不能为空').clear).toBe(true)
    expect(attachmentUploadFailure(409, '草稿已转为正式入库单').clear).toBe(true)
  })

  it('商品图片状态变化后不再重试刚才这次上传，登录失效仍用同一张', () => {
    expect(imageUploadFailure(409, '商品状态已变化，请刷新商品').clear).toBe(true)
    expect(imageUploadFailure(409, '商品状态已变化，请刷新商品').text).toContain('不要重试刚才这次上传')
    expect(imageUploadFailure(401, 'Unauthorized').clear).toBe(false)
    expect(imageUploadFailure(401, 'Unauthorized').text).toContain('同一张图片')
    expect(imageUploadFailure(409, '原图片内容不同，不要修改后重试').mismatch).toBe(true)
    expect(imageUploadFailure(400, '最多上传 8 张图片').clear).toBe(true)
  })
})
