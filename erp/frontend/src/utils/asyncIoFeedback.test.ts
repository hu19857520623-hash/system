import { describe, it, expect } from 'vitest'
import { formatImportFailureLine } from './importFailureDetail'
import { asyncJobState, asyncJobNextStep, asyncJobError, asyncFilterSummary, asyncModuleLabel } from './asyncIoFeedback'

describe('异步任务中文结果及可恢复入口', () => {
  it('失败和部分成功不会显示等待中，未知状态不泄漏英文', () => {
    expect(asyncJobState('failed').label).toBe('失败')
    expect(asyncJobState('partial').label).toBe('部分成功')
    expect(asyncJobState('SyntheticUnknownStatus').label).toBe('状态待核对')
    expect(asyncModuleLabel('unknown-module')).toBe('历史任务')
    expect(asyncJobError('SQLSTATE EACCES secret-path')).not.toContain('secret-path')
    expect(formatImportFailureLine({ lineNo: 3, reason: 'PrismaClient EACCES secret-path' })).toBe('第 3 行：该行导入失败，请核对文件内容后重试')
  })
  it('部分导入要求仅修正失败行，旧导出不猜测筛选范围', () => {
    expect(asyncJobNextStep({ jobType: 'import', status: 'partial' })).toContain('成功行无需重复导入')
    expect(asyncJobNextStep({ jobType: 'export', status: 'failed', canRetry: false })).toContain('返回原业务页面')
    expect(asyncJobNextStep({ jobType: 'export', status: 'failed', canRetry: true })).toContain('原筛选')
    expect(asyncFilterSummary(null)).toContain('未保存筛选')
  })
  it('详情显示实际原筛选范围，并说明重试读取最新数据', () => {
    expect(asyncFilterSummary({ keyword: 'AUDIT', minAmount: '9', range: 'month' })).toBe('关键词：AUDIT；最低金额：9；时间范围：本月')
    expect(asyncJobNextStep({ jobType: 'export', status: 'failed', canRetry: true })).toContain('当前最新数据')
    expect(asyncJobState('completed').tone).toBe('success')
  })
  it('中断、旧任务恢复及未知状态均有中文下一步，不把导入误认为可自动恢复', () => {
    expect(asyncJobState('interrupted').label).toBe('执行已中断')
    expect(asyncJobState('legacy_unconfirmed').label).toBe('结果待核对')
    expect(asyncJobNextStep({ jobType: 'export', status: 'processing', displayStatus: 'interrupted', canRetry: true })).toContain('按原筛选恢复')
    expect(asyncJobNextStep({ jobType: 'export', status: 'processing', displayStatus: 'legacy_unconfirmed', canRestart: true })).toContain('新建恢复任务')
    expect(asyncJobNextStep({ jobType: 'export', status: 'processing', replacementJobId: 9 })).toContain('查看恢复任务')
    expect(asyncJobNextStep({ jobType: 'export', status: 'old-unknown' })).toContain('任务状态待核对')
    expect(asyncJobNextStep({ jobType: 'import', status: 'processing', displayStatus: 'interrupted' })).toContain('勿重复上传')
  })

})
