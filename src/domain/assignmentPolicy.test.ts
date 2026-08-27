import { describe, expect, it } from 'vitest'
import { canApproveCapacityOverride, evaluateCapacity, evaluateRepeatPolicy } from './assignmentPolicy'
import type { Course } from './catalog'

const course: Course = {
  id: 'course-1', organizationId: 'org-1', version: 1,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-1', updatedAt: '2026-08-27T10:00:00Z', updatedBy: 'coordinator-1',
  cycleId: 'cycle-1', clusterId: 'cluster-1', logicalCourseId: 'theater', label: 'תיאטרון', description: '', subjectArea: 'אמנויות',
  instructorIds: ['teacher-1'], slot: 'slot-a', eligibleGradeIds: ['grade-7'], capacity: { minimum: 8, target: 18, maximum: 20 }, repeatPolicy: 'allowed', published: true,
}

describe('assignment policies', () => {
  it('allows a repeat when the course policy allows it', () => {
    expect(evaluateRepeatPolicy(course, ['theater']).outcome).toBe('allowed')
  })

  it('blocks a prohibited repeat', () => {
    expect(evaluateRepeatPolicy({ ...course, repeatPolicy: 'prohibited' }, ['theater']).outcome).toBe('blocked')
  })

  it('requires a second approver only above maximum capacity', () => {
    expect(evaluateCapacity(course, 20, 1)).toMatchObject({ outcome: 'override_required', requiresSecondApprover: true })
    expect(evaluateCapacity(course, 18, 1)).toMatchObject({ outcome: 'above_target', requiresSecondApprover: false })
  })

  it('does not allow the executor to approve their own capacity override', () => {
    expect(canApproveCapacityOverride('coordinator-1', 'coordinator-1')).toBe(false)
    expect(canApproveCapacityOverride('coordinator-1', 'coordinator-2')).toBe(true)
  })
})
