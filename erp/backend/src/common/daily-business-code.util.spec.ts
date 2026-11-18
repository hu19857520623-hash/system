import type { Prisma } from '@prisma/client'
import { nextDailyBusinessCode } from './daily-business-code.util'

function setup(lastValue: number, occupiedCodes: string[] = []) {
  const executeRaw = jest.fn().mockResolvedValue(1)
  const queryRaw = jest.fn(async (sql: TemplateStringsArray, code: string) =>
    sql[0].includes('SELECT current_serial') ? [{ current_serial: BigInt(lastValue) }] : occupiedCodes.includes(code) ? [{ id: 1n }] : [],
  )
  const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
  return { tx, executeRaw, queryRaw }
}

describe('PD / SUP 日流水', () => {
  it('以北京时间午夜切换计数日期，两个前缀独立取号', async () => {
    const { tx, executeRaw } = setup(1)
    const before = new Date('2026-11-17T15:59:59.999Z')
    const after = new Date('2026-11-17T16:00:00.000Z')
    await expect(nextDailyBusinessCode(tx, 'PD', before)).resolves.toBe('PD202611170001')
    await expect(nextDailyBusinessCode(tx, 'PD', after)).resolves.toBe('PD202611180001')
    await expect(nextDailyBusinessCode(tx, 'SUP', after)).resolves.toBe('SUP202611180001')
    expect(executeRaw.mock.calls.map(([, ...params]) => params)).toEqual([
      ['PD', '20261117'], ['PD', '20261118'], ['SUP', '20261118'],
    ])
    expect(executeRaw.mock.calls[0][0].join('')).toContain('ON DUPLICATE KEY UPDATE current_serial = current_serial + 1')
  })

  it('跳过已存在的同格式编码并把计数推进到实际发出的号码', async () => {
    const { tx, executeRaw, queryRaw } = setup(7, ['SUP202611180007', 'SUP202611180008'])
    await expect(nextDailyBusinessCode(tx, 'SUP', new Date('2026-11-18T00:00:00Z'))).resolves.toBe('SUP202611180009')
    expect(queryRaw.mock.calls[1][0][0]).toContain('FROM supplier')
    expect(executeRaw).toHaveBeenLastCalledWith(expect.any(Array), 9, 'SUP', '20261118')
  })

  it('允许发出 9999，超过上限不生成变长或回绕编号', async () => {
    const now = new Date('2026-11-18T00:00:00Z')
    await expect(nextDailyBusinessCode(setup(9999).tx, 'PD', now)).resolves.toBe('PD202611189999')
    const full = setup(10000)
    await expect(nextDailyBusinessCode(full.tx, 'PD', now)).rejects.toThrow('每日上限（9999）')
    expect(full.queryRaw).toHaveBeenCalledTimes(1)
  })
})
