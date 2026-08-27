import { describe, expect, it } from 'vitest'
import { validateCourse, type Course } from './catalog'

const course: Course = {
  id: 'course-1', organizationId: 'org-1', version: 1,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-1', updatedAt: '2026-08-27T10:00:00Z', updatedBy: 'coordinator-1',
  cycleId: 'cycle-1', clusterId: 'cluster-1', logicalCourseId: 'robotics', label: 'רובוטיקה', description: '', subjectArea: 'טכנולוגיה',
  instructorIds: ['teacher-1'], slot: 'slot-a', eligibleGradeIds: ['grade-7'], capacity: { minimum: 8, target: 18, maximum: 20 }, repeatPolicy: 'allowed', published: true,
}

describe('course validation', () => {
  it('accepts a valid configurable capacity', () => {
    expect(validateCourse(course).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('rejects capacity values that are out of order', () => {
    expect(validateCourse({ ...course, capacity: { minimum: 12, target: 10, maximum: 20 } }).map((issue) => issue.code)).toContain('course.capacity.invalid_order')
  })
})
