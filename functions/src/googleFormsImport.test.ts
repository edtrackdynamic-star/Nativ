import { describe, expect, it } from 'vitest'
import type { CycleCatalogSnapshot } from '../../src/domain/catalog'
import { readRows, suggestMapping } from './googleFormsImport'

const catalog = {
  organizationId: 'school', cycleId: 'cycle', clusters: [
    { clusterId: 'wednesday', label: 'יום רביעי', requiredRankingCount: 2, eligibleClassIds: ['z'], rationaleMode: 'optional', weeklySlot: { weekday: 3, periodStart: 1, periodEnd: 2 }, courses: [{ courseId: 'art', label: 'אומנות' }, { courseId: 'theater', label: 'תיאטרון' }] },
    { clusterId: 'thursday', label: 'יום חמישי', requiredRankingCount: 2, eligibleClassIds: ['z', 't'], rationaleMode: 'optional', weeklySlot: { weekday: 4, periodStart: 1, periodEnd: 2 }, courses: [{ courseId: 'law', label: 'חוק ומשפט' }, { courseId: 'media', label: 'פודקסטים' }] },
  ],
} as CycleCatalogSnapshot

const headers = ['חותמת זמן', 'שם מלא', 'כיתה', 'סיבה יום רביעי', 'אומנות', 'תיאטרון', 'חוק ומשפט', 'פודקסטים', 'סיבה יום חמישי']
const mapping = suggestMapping(headers, catalog)
const students = [
  { id: 'u1', name: 'דנה כהן', classId: 'z', className: 'כיתה ז׳1' },
  { id: 'u2', name: 'רוני לוי', classId: 't', className: 'כיתה ט' },
]

describe('Google Forms import review', () => {
  it('matches headers and includes only eligible clusters', () => {
    expect(mapping.courses).toEqual({ art: 4, theater: 5, law: 6, media: 7 })
    expect(mapping.rationales).toEqual({ wednesday: 3, thursday: 8 })
    const rows = readRows([headers, ['1', 'דנה כהן', 'ז1', 'נימוק', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות שניה', 'עדיפות ראשונה', 'נימוק'], ['2', 'רוני לוי', 'ט', '', '', '', 'עדיפות ראשונה', 'עדיפות שניה', '']], catalog, students, mapping)
    expect(rows.map((row) => row.errors)).toEqual([[], []])
    expect(rows[0].choices).toHaveLength(2)
    expect(rows[1].choices.map((choice) => choice.clusterId)).toEqual(['thursday'])
  })

  it('keeps only the last response for a student and blocks incomplete ranks', () => {
    const rows = readRows([headers, ['1', 'דנה כהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות שניה', ''], ['2', 'דנה כהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', '', '']], catalog, students, mapping)
    expect(rows[0].duplicateOf).toBe(3)
    expect(rows[1].errors.some((error) => error.includes('דירוגים'))).toBe(true)
  })

  it('requires an explicit student choice when identity does not match', () => {
    const source = [headers, ['1', 'דנה קהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות שניה', '']]
    expect(readRows(source, catalog, students, mapping)[0].errors).toContain('לא נמצא תלמיד תואם ברשימת בית הספר')
    expect(readRows(source, catalog, students, { ...mapping, students: { '2': 'u1' } })[0].errors).toEqual([])
  })

  it('does not silently treat two different names as repeat responses', () => {
    const source = [headers, ['1', 'דנה כהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות שניה', ''], ['2', 'דנה קהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות שניה', '']]
    const rows = readRows(source, catalog, students, { ...mapping, students: { '3': 'u1' } })
    expect(rows[0].duplicateOf).toBeUndefined()
    expect(rows.every((row) => row.errors.some((error) => error.includes('לאותו תלמיד')))).toBe(true)
  })
})
