import { describe, expect, it } from 'vitest'
import type { Course } from './catalog'
import { runDeterministicAssignment, type AssignmentStudent } from './assignmentEngine'

const meta = { organizationId: 'org', version: 1, createdAt: 'now', createdBy: 'u', updatedAt: 'now', updatedBy: 'u' }
function course(id: string, target = 1, maximum = 1): Course {
  return { ...meta, id, cycleId: 'cycle', clusterId: 'cluster', logicalCourseId: id, label: id, description: '', subjectArea: '', instructorIds: ['t'], slot: 'a', eligibleGradeIds: ['g'], capacity: { minimum: 0, target, maximum }, repeatPolicy: 'allowed', published: true }
}
function student(studentId: string, first: string, priority: 'high' | 'medium' | 'neutral'): AssignmentStudent {
  return { studentId, displayLabel: studentId, approvedAiByCluster: { cluster: priority }, submission: { preferences: [{ clusterId: 'cluster', rankings: [{ courseId: first, rank: 1 }, { courseId: first === 'a' ? 'b' : 'a', rank: 2 }] }] } }
}

describe('runDeterministicAssignment', () => {
  it('uses approved AI priority only as a tie breaker and remains deterministic', () => {
    const input = { cycleId: 'cycle', clusterIds: ['cluster'], courses: [course('a'), course('b', 2, 2)], students: [student('neutral', 'a', 'neutral'), student('high', 'a', 'high')] }
    const first = runDeterministicAssignment(input)
    expect(first).toEqual(runDeterministicAssignment(input))
    expect(first.assignments.find((entry) => entry.courseId === 'a')?.studentId).toBe('high')
    expect(first.assignments.find((entry) => entry.studentId === 'neutral')?.rank).toBe(2)
  })

  it('places submitters before students who did not submit', () => {
    const result = runDeterministicAssignment({ cycleId: 'cycle', clusterIds: ['cluster'], courses: [course('a'), course('b')], students: [student('submitted', 'a', 'neutral'), { studentId: 'none', displayLabel: 'none' }] })
    expect(result.assignments.find((entry) => entry.studentId === 'submitted')?.courseId).toBe('a')
    expect(result.assignments.find((entry) => entry.studentId === 'none')?.source).toBe('fallback_non_submitter')
  })

  it('enforces must-assign and prohibited-repeat rules', () => {
    const courses = [course('a'), { ...course('b'), logicalCourseId: 'old', repeatPolicy: 'prohibited' as const }]
    const students: AssignmentStudent[] = [{ ...student('s', 'b', 'high'), previouslyCompletedLogicalCourseIds: ['old'] }]
    const result = runDeterministicAssignment({ cycleId: 'cycle', clusterIds: ['cluster'], courses, students, constraints: [{ studentId: 's', clusterId: 'cluster', type: 'must_assign', courseId: 'a', note: 'צורך פדגוגי' }] })
    expect(result.assignments[0]).toMatchObject({ studentId: 's', courseId: 'a', source: 'hard_constraint' })
  })
})
