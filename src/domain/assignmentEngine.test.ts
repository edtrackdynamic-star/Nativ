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

  it('does not transfer a rationale priority to another course in the same cluster', () => {
    const interestedInArt = { ...student('art', 'b', 'neutral'), approvedAiByCourse: { a: 'high' as const, b: 'neutral' as const } }
    const interestedInScience = { ...student('science', 'b', 'neutral'), approvedAiByCourse: { a: 'neutral' as const, b: 'medium' as const } }
    const result = runDeterministicAssignment({ cycleId: 'cycle', clusterIds: ['cluster'], courses: [course('a'), course('b')], students: [interestedInArt, interestedInScience] })
    expect(result.assignments.find((entry) => entry.courseId === 'b')).toMatchObject({ studentId: 'science', aiPriority: 'medium' })
    expect(result.assignments.find((entry) => entry.studentId === 'art')).toMatchObject({ courseId: 'a', aiPriority: 'high' })
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

  it('keeps class balancing disabled unless the cluster explicitly enables it', () => {
    const students = [student('s1', 'a', 'neutral'), student('s2', 'a', 'neutral')]
    const input = { cycleId: 'cycle', clusterIds: ['cluster'], courses: [course('a'), course('b')], students }
    expect(runDeterministicAssignment(input)).toEqual(runDeterministicAssignment({ ...input, balanceByClassClusterIds: [] }))
  })

  it('spreads students from each homeroom across courses when enabled', () => {
    const students = ['א', 'ב'].flatMap((classId) => Array.from({ length: 4 }, (_, index) => ({ ...student(`${classId}-${index}`, 'a', 'neutral'), classId, classLabel: `כיתה ${classId}` })))
    const result = runDeterministicAssignment({ cycleId: 'cycle', clusterIds: ['cluster'], courses: [course('a', 4, 4), course('b', 4, 4)], students, balanceByClassClusterIds: ['cluster'] })
    for (const courseId of ['a', 'b']) {
      const assignedIds = new Set(result.assignments.filter((entry) => entry.courseId === courseId).map((entry) => entry.studentId))
      expect(students.filter((entry) => assignedIds.has(entry.studentId) && entry.classId === 'א')).toHaveLength(2)
      expect(students.filter((entry) => assignedIds.has(entry.studentId) && entry.classId === 'ב')).toHaveLength(2)
    }
  })

  it('excludes a class or one student without changing their submitted preferences', () => {
    const students = [
      { ...student('a1', 'a', 'neutral'), classId: 'a' },
      { ...student('a2', 'a', 'neutral'), classId: 'a' },
      { ...student('b1', 'a', 'neutral'), classId: 'b' },
    ]
    const courses = [course('a', 10, 10)]
    const excludedClass = runDeterministicAssignment({ cycleId:'cycle', clusterIds:['cluster'], courses, students, excludedClassIdsByCluster:{cluster:['a']} })
    expect(excludedClass.assignments.map(entry=>entry.studentId)).toEqual(['b1'])
    const excludedStudent = runDeterministicAssignment({ cycleId:'cycle', clusterIds:['cluster'], courses, students, excludedStudentIdsByCluster:{cluster:['a2']} })
    expect(excludedStudent.assignments.map(entry=>entry.studentId).sort()).toEqual(['a1','b1'])
    expect(students.every(entry=>entry.submission?.preferences.length===1)).toBe(true)
  })
})

it('excludes other classes from ranked and fallback assignments and rejects a forced override', () => {
  const input = {cycleId:'cycle',clusterIds:['cluster'],courses:[course('a',10,10)],eligibleClassIdsByCluster:{cluster:['a']},students:[
    {...student('eligible','a','neutral'),classId:'a'},
    {...student('ineligible','a','high'),classId:'b'},
    {studentId:'fallback',displayLabel:'fallback',classId:'b'},
    {studentId:'unknown',displayLabel:'unknown'},
    {studentId:'eligible-fallback',displayLabel:'eligible-fallback',classId:'a'},
  ]}
  const result=runDeterministicAssignment(input)
  expect(result.assignments.map(a=>a.studentId).sort()).toEqual(['eligible','eligible-fallback'])
  expect(result.warnings).toEqual([])
  expect(()=>runDeterministicAssignment({...input,constraints:[{studentId:'ineligible',clusterId:'cluster',courseId:'a',type:'must_assign',note:'override'}]})).toThrow()
})
