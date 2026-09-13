import { describe, expect, it } from 'vitest'
import type { Course, CycleCatalogSnapshot } from './catalog'
import type { AssignmentRun } from './workflow'
import type { StudentRosterEntry } from './studentRoster'
import { boardCellLabel, buildAssignmentBoard } from './assignmentBoard'

const sampleRun = { id: 'run-1', label: 'הרצה 1', executedAt: '2026-09-13T10:00:00.000Z', executedBy: 'coordinator', algorithmVersion: 'negative-last-resort-1.1.0', seed: 42,
  assignments: [{ studentId: 's1', studentLabel: 'יעל', studentClassLabel: 'ז1', clusterId: 'cluster-a', courseId: 'course-a', rank: 1, source: 'ranked_choice', aiPriority: 'neutral', explanation: '' }],
  enrollmentByCourse: { 'course-a': 1 }, warnings: [], tieBreaks: [], includedStudentClusterCount: 1,
  scope: { excludedClassIdsByCluster: {}, excludedStudentIdsByCluster: { 'cluster-a': ['s3'] } },
} satisfies AssignmentRun
const sampleCourses = [{ id: 'course-a', clusterId: 'cluster-a', label: 'מדע & אמנות', meetingPlace: 'חדר אמנות', capacity: { minimum: 0, target: 12, maximum: 18 } }] as Course[]
const sampleCatalog = { clusters: [{ clusterId: 'cluster-a', label: 'העמקה', requiredRankingCount: 1, courses: [{ courseId: 'course-a', logicalCourseId: 'course-a', label: 'מדע & אמנות', instructorNames: ['מורה'] }] }, { clusterId: 'cluster-b', label: 'לז בלבד', requiredRankingCount: 1, eligibleClassIds: ['class-z'], courses: [] }] } as CycleCatalogSnapshot
const sampleRoster: StudentRosterEntry[] = [
  { id: 's1', name: 'יעל', classId: 'class-z', classLabel: 'ז1', status: 'assigned', choiceSource: 'nativ_app', choices: [{ clusterId: 'cluster-a', courseId: 'course-a', rank: 1 }], assignments: [{ clusterId: 'cluster-a', courseId: 'course-a' }] },
  { id: 's2', name: 'דני', classId: 'class-z', classLabel: 'ז1', status: 'not_submitted', choices: [], assignments: [] },
  { id: 's3', name: 'רוני', classId: 'class-z', classLabel: 'ז1', status: 'submitted', choiceSource: 'nativ_app', choices: [{ clusterId: 'cluster-a', courseId: 'course-a', rank: 1 }], assignments: [] },
  { id: 's4', name: 'תמר', classId: 'class-h', classLabel: 'ח1', status: 'not_submitted', choices: [], assignments: [] },
]

describe('assignment board', () => {
  it('keeps all roster students and distinguishes missing form, exclusion and inapplicable cluster', () => {
    const board = buildAssignmentBoard(sampleRun, sampleRoster, sampleCourses, sampleCatalog)
    expect(board.students).toHaveLength(4)
    expect(board.assignmentCount).toBe(1)
    expect(board.students.find(student => student.id === 's1')?.cells['cluster-a'].assignment?.rank).toBe(1)
    expect(boardCellLabel(board.students.find(student => student.id === 's2')!.cells['cluster-a'])).toBe('לא הוגש טופס')
    expect(boardCellLabel(board.students.find(student => student.id === 's3')!.cells['cluster-a'])).toBe('לא נכלל בהרצה')
    expect(boardCellLabel(board.students.find(student => student.id === 's4')!.cells['cluster-b'])).toBe('לא מיועד לכיתה')
    expect(board.courses[0].students.map(student => student.id)).toEqual(['s1'])
    expect(board.courses[0].meetingPlace).toBe('חדר אמנות')
  })
  it('surfaces mismatched counts and missing catalog items without dropping assigned students', () => {
    const run: AssignmentRun = { ...sampleRun, includedStudentClusterCount: 3, assignments: [...sampleRun.assignments, { ...sampleRun.assignments[0], studentId: 'missing', courseId: 'unknown' }] }
    const board = buildAssignmentBoard(run, sampleRoster, sampleCourses, sampleCatalog)
    expect(board.students.some(student => student.id === 'missing')).toBe(true)
    expect(board.issues.some(issue => issue.includes('קורס משובץ'))).toBe(true)
    expect(board.issues.some(issue => issue.includes('מספר השיבוצים'))).toBe(true)
  })
})
