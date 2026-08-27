import { describe, expect, it } from 'vitest'
import { validateConstraint, type PlacementConstraint } from './constraints'

const constraint: PlacementConstraint = {
  id: 'constraint-1', organizationId: 'org-1', version: 1,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-1', updatedAt: '2026-08-27T10:00:00Z', updatedBy: 'coordinator-1',
  cycleId: 'cycle-1', studentId: 'student-1', clusterId: 'cluster-1', courseId: 'course-1', kind: 'must_assign', source: 'manual',
  internalReason: 'התאמת מערכת מאושרת', approvedBy: 'coordinator-2', approvedAt: '2026-08-27T10:05:00Z', active: true,
}

describe('hard constraint validation', () => {
  it('requires an internal reason and approval metadata', () => {
    expect(validateConstraint(constraint)).toEqual([])
    expect(validateConstraint({ ...constraint, internalReason: '' }).map((issue) => issue.code)).toContain('constraint.reason_required')
  })
})
