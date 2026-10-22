import { fetchOmsInboundRows } from './oms-inbound-bridge.util'

describe('OMS inbound warehouse submission boundary', () => {
  const raw = (status: string) => ({ id: status, inboundNo: `IN-${status}`, status, createdAt: '2026-10-14' })

  it.each([undefined, 'all'])('excludes drafts from the all-status query (%s)', async status => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([
      raw('draft'), raw('oms_draft'), raw(' Draft '), raw('on_the_way'), raw('receiving'), raw('partial'), raw('shelved'), raw('voided'),
    ]) }
    const result = await fetchOmsInboundRows(prisma as any, { status })
    expect(result.map(r => r.inboundNo)).toEqual(['IN-on_the_way', 'IN-receiving', 'IN-partial', 'IN-shelved', 'IN-voided'])
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('LOWER(TRIM(i.status)) NOT IN (?, ?)'), 'draft', 'oms_draft')
  })

  it.each(['draft', 'oms_draft', ' draft ', 'DRAFT'])('does not expose drafts through an explicit status filter (%s)', async status => {
    const prisma = { $queryRawUnsafe: jest.fn() }
    expect(await fetchOmsInboundRows(prisma as any, { status, keyword: 'IN-draft' })).toEqual([])
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('keeps submission and keyword filters parameterized alongside draft exclusion', async () => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([raw('on_the_way')]) }
    const result = await fetchOmsInboundRows(prisma as any, { status: 'pending_receipt', keyword: 'REF-1' })
    expect(result[0].displayStatus).toBe('pending_receipt')
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(TRIM(i.status)) NOT IN (?, ?)'), 'draft', 'oms_draft', 'on_the_way', '%REF-1%', '%REF-1%', '%REF-1%', '%REF-1%',
    )
  })
})
