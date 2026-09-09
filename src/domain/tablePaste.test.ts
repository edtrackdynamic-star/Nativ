import { expect, it } from 'vitest'
import { capacityError, parseTable } from './tablePaste'

it('keeps all six user rows from a Markdown table including the first row', () => {
  const rows = parseTable('| יעל | תאטרון |\n| ----: | ----: |\n| ראם | כוח מד"א |\n| הילה | חוק ומשפט |\n| יואל | פודקסטים וולוגים |\n| רינת | ערבית |\n| אופיר | עיצוב |')
  expect(rows).toHaveLength(6)
  expect(rows[0]).toEqual(['יעל','תאטרון'])
  expect(rows[1]).toEqual(['ראם','כוח מד"א'])
  expect(rows[5]).toEqual(['אופיר','עיצוב'])
})
it('keeps escaped pipes and rejects uneven Markdown rows', () => {
  expect(parseTable('| מורה | קורס \\| נוסף |')).toEqual([['מורה','קורס | נוסף']])
  expect(() => parseTable('| א | ב |\n| ג |')).toThrow()
})

it('preserves spreadsheet columns, multiline cells and escaped quotes', () => {
  expect(parseTable('מקבץ\tקורס\tתיאור\r\nא\tמדעים\t"שורה 1\nשורה ""2"""\r\n')).toEqual([['מקבץ','קורס','תיאור'],['א','מדעים','שורה 1\nשורה "2"']])
})
it('preserves empty cells and ignores blank rows', () => {
  expect(parseTable('א\t\t22\n\t\t\nב\t18\t')).toEqual([['א','','22'],['ב','18','']])
})
it('rejects incomplete quoted cells and oversized imports', () => {
  expect(() => parseTable('"unfinished')).toThrow()
  expect(() => parseTable('a\n'.repeat(202))).toThrow()
})
it('does not treat an erased capacity as zero', () => {
  expect(capacityError('',18,22)).not.toBe('')
  expect(capacityError('0','18','22')).toBe('')
  for (const values of [[-1,18,22],[0,23,22],[0,0,0],[0,1.5,22]] as const) expect(capacityError(values[0], values[1], values[2])).not.toBe('')
})

