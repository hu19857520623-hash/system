import { describe, expect, it } from 'vitest'
import { ownLeadCanBeCorrected } from './leadCorrection.ts'

describe('ownLeadCanBeCorrected', () => {
  const lead = { createdById: 9, status: 'new', customerId: null, deals: [] }

  it('allows the registrant to correct an open lead', () => {
    expect(ownLeadCanBeCorrected(lead, 9)).toBe(true)
  })

  it('hides the action from other people, historical leads, and dealt leads', () => {
    expect(ownLeadCanBeCorrected(lead, 8)).toBe(false)
    expect(ownLeadCanBeCorrected({ ...lead, createdById: null }, 9)).toBe(false)
    expect(ownLeadCanBeCorrected({ ...lead, status: 'deal' }, 9)).toBe(false)
    expect(ownLeadCanBeCorrected({ ...lead, deals: [{ id: 1 }] }, 9)).toBe(false)
    expect(ownLeadCanBeCorrected({ ...lead, customerId: 4 }, 9)).toBe(false)
    expect(ownLeadCanBeCorrected({ ...lead, status: 'lost' }, 9)).toBe(true)
  })
})
