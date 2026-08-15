import fs from 'fs'
import path from 'path'
import { MANUAL_SQL_SCRIPTS, MIGRATION_ORDER } from './migration-plan'

describe('database migration plan', () => {
  it('lists every SQL migration exactly once', () => {
    const scriptsDir = path.join(__dirname, 'scripts')
    const files = fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.sql')).sort()
    const classified = [...MIGRATION_ORDER, ...MANUAL_SQL_SCRIPTS]
    expect([...new Set(classified)].sort()).toEqual(files)
    expect(new Set(MIGRATION_ORDER).size).toBe(MIGRATION_ORDER.length)
    expect(new Set(MANUAL_SQL_SCRIPTS).size).toBe(MANUAL_SQL_SCRIPTS.length)
    expect(new Set(classified).size).toBe(classified.length)
  })
})
