import { describe, expect, it } from 'vitest'
import { redactDirectIdentifiers } from './privacy'

describe('AI input redaction', () => {
  it('removes email addresses before an external evaluation', () => {
    const result = redactDirectIdentifiers('אפשר לפנות אלי ב-test@example.com לגבי הבחירה')
    expect(result.sanitizedText).not.toContain('test@example.com')
    expect(result.redactions).toContain('email')
  })

  it('leaves a regular optional rationale intact', () => {
    const rationale = 'אני רוצה להתנסות בתיאטרון ולפתח ביטחון מול קהל'
    expect(redactDirectIdentifiers(rationale)).toEqual({ sanitizedText: rationale, redactions: [] })
  })
})
