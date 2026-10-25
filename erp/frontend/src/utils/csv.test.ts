import { describe, expect, it } from 'vitest'
import { LEADS_IMPORT_FIELDS } from '@/constants/importTemplates.ts'

describe('lead import template channel note', () => {
  it('lists the selectable sources, including 视频号', () => {
    const source = LEADS_IMPORT_FIELDS.find((field) => field.key === 'source')
    expect(source?.hint).toContain('留空默认 Takealot')
    expect(source?.hint).toContain('Takealot、官网、展会、推荐、小红书、抖音、视频号、公众号、其他')
  })
})
