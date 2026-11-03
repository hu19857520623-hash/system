import { describe, expect, it } from 'vitest'
import { createReturnReadGate } from './returnReadGate'

describe('return detail and log read scope', () => {
  it('rejects a slow previous selection and accepts current selection', () => {
    const gate = createReturnReadGate(() => 'session7'), first = gate.begin(() => true), second = gate.begin(() => true)
    expect(first()).toBe(false); expect(second()).toBe(true)
  })
  it('rejects account/permission changes, closed dialogs and disposed pages', () => {
    let scope: string | null = 'actor7:permissions', visible = true
    const gate = createReturnReadGate(() => scope), first = gate.begin(() => visible)
    scope = 'actor8:permissions'; expect(first()).toBe(false)
    const second = gate.begin(() => visible); visible = false; expect(second()).toBe(false)
    visible = true; const third = gate.begin(() => visible); gate.invalidate(); expect(third()).toBe(false)
    scope = null; expect(gate.begin(() => true)()).toBe(false)
  })
  it('does not let a closed and reopened dialog accept the old failure or response', () => {
    const gate = createReturnReadGate(() => '7'), first = gate.begin(() => true)
    gate.invalidate(); const retry = gate.begin(() => true)
    expect(first()).toBe(false); expect(retry()).toBe(true)
  })
})
