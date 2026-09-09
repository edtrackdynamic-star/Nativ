import { describe, expect, it } from 'vitest'
import { currentSchoolYearStart, schoolYearId, schoolYearOptions, isCurrentYearWindow, schoolYearStart, preferredCycleId } from './schoolYear'
const now=new Date('2026-09-09T12:00:00Z')
describe('school year selection',()=>{
  it('offers exactly the previous, current and next year with one spelling',()=>{
    expect(schoolYearOptions(now)).toEqual([{id:'2025-2026',label:'תשפ״ו · \u20662025–2026\u2069'},{id:'2026-2027',label:'תשפ״ז · \u20662026–2027\u2069'},{id:'2027-2028',label:'תשפ״ח · \u20662027–2028\u2069'}])
    expect(schoolYearId(currentSchoolYearStart(now))).toBe('2026-2027')
  })
  it('rolls over at midnight on September 1 in Jerusalem',()=>{
    expect(currentSchoolYearStart(new Date('2026-08-31T20:59:59Z'))).toBe(2025)
    expect(currentSchoolYearStart(new Date('2026-08-31T21:00:00Z'))).toBe(2026)
    expect(currentSchoolYearStart(new Date('2027-01-01T12:00:00Z'))).toBe(2026)
  })
  it('rejects free text, malformed periods and years outside the rolling window',()=>{
    for(const value of ['תשפ״ז','2026/2027','2026-2028','2024-2025','2028-2029','2026'])expect(isCurrentYearWindow(value,now)).toBe(false)
    expect(schoolYearStart('2026-2028')).toBe(null)
  })
  it('selects the current year ahead of recently updated archived cycles',()=>{
    const cycles=[{id:'old',schoolYear:'2023-2024'},{id:'next',schoolYear:'2027-2028'},{id:'current',schoolYear:'2026-2027'}]
    expect(preferredCycleId(cycles,now)).toBe('current')
    expect(preferredCycleId(cycles.slice(0,1),now)).toBe(null)
    expect(preferredCycleId(cycles.slice(0,2),now)).toBe('next')
  })
  it('moves an older year to the archive without changing its identifier',()=>{
    expect(isCurrentYearWindow('2025-2026',now)).toBe(true)
    expect(isCurrentYearWindow('2025-2026',new Date('2027-09-01T12:00:00Z'))).toBe(false)
  })
})
