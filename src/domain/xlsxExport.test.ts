import { describe, expect, it } from 'vitest'
import type { AssignmentBoard } from './assignmentBoard'
import type { Course } from './catalog'
import type { AssignmentRun } from './workflow'
import { createAssignmentWorkbook } from './xlsxExport'

describe('assignment workbook export', () => {
  it('creates RTL course and class sheets with readable headers, statuses and numeric counts', () => {
    const run = { id: 'run', label: 'הרצה 1', executedAt: '2026-09-13T10:00:00.000Z' } as AssignmentRun
    const board: AssignmentBoard = { clusters: [{ id: 'cluster', label: 'העמקה', weeklySlot: 'יום רביעי, שעה 6' }], students: [
      { id: 's1', name: 'יעל', classId: 'z', classLabel: 'ז1', hasForm: true, cells: { cluster: { status: 'assigned', assignment: { studentId: 's1', clusterId: 'cluster', courseId: 'course', rank: 1, source: 'ranked_choice', aiPriority: 'neutral', explanation: '' }, course: { label: 'מדע & אמנות' } as Course } } },
      { id: 's2', name: 'דני', classId: 'z', classLabel: 'ז1', hasForm: false, cells: { cluster: { status: 'no_form' } } },
    ], courses: [{ id: 'course', label: 'מדע & אמנות', clusterId: 'cluster', clusterLabel: 'העמקה', meetingPlace: 'חדר אמנות', instructorNames: ['מורה'], weeklySlot: 'יום רביעי, שעה 6', target: 12, maximum: 18, students: [] }], issues: [], assignmentCount: 1 }
    board.courses[0].students = [board.students[0]]
    const workbook = createAssignmentWorkbook(board, run)
    const text = new TextDecoder().decode(workbook)
    expect(Array.from(workbook.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(text).toContain('xl/styles.xml')
    expect(text).toContain('שיבוץ לפי קורסים')
    expect(text).toContain('כיתה ז1')
    expect(text).toContain('פירוט שיבוצים')
    expect(text).toContain('מדע &amp; אמנות')
    expect(text).toContain('לא הוגש טופס')
    expect(text).toContain('חדר אמנות')
    expect(text).toContain('rightToLeft="1"')
    expect(text).toContain('<v>1</v>')
  })
})
