import { describe, expect, it } from 'vitest'
import { createAssignmentWorkbook } from './xlsxExport'

describe('assignment workbook export', () => {
  it('creates a ZIP workbook with both Hebrew sheets and escapes cell text', () => {
    const workbook = createAssignmentWorkbook([['תלמידה', 'קורס'], ['יעל', 'מדע & אמנות']], [['כיתה', 'תלמידה'], ['ט׳1', 'יעל']])
    const text = new TextDecoder().decode(workbook)
    expect(Array.from(workbook.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('xl/worksheets/sheet2.xml')
    expect(text).toContain('מדע &amp; אמנות')
    expect(text).toContain('לפי כיתה')
  })
})
