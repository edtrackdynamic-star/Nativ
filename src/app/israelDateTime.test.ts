import { expect, it } from 'vitest'
import { fromIsraelDateTimeInput, toIsraelDateTimeInput } from './israelDateTime'

it('uses Israel daylight saving time for deadline input', () => {
  expect(fromIsraelDateTimeInput('2026-01-15T18:00')).toBe('2026-01-15T16:00:00.000Z')
  expect(fromIsraelDateTimeInput('2026-09-15T18:00')).toBe('2026-09-15T15:00:00.000Z')
  expect(toIsraelDateTimeInput('2026-09-15T15:00:00.000Z')).toBe('2026-09-15T18:00')
})
