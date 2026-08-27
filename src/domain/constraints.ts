import type { ValidationIssue, VersionedEntity } from './types'

export const constraintKinds = ['must_assign', 'must_not_assign'] as const
export type ConstraintKind = (typeof constraintKinds)[number]

export const constraintSources = ['manual', 'schedule_change', 'appeal', 'import'] as const
export type ConstraintSource = (typeof constraintSources)[number]

export interface PlacementConstraint extends VersionedEntity {
  cycleId: string
  studentId: string
  clusterId: string
  courseId: string
  kind: ConstraintKind
  source: ConstraintSource
  internalReason: string
  approvedBy: string
  approvedAt: string
  active: boolean
}

export function validateConstraint(constraint: PlacementConstraint): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!constraint.internalReason.trim()) {
    issues.push({ code: 'constraint.reason_required', message: 'אילוץ קשיח מחייב נימוק פנימי', path: 'internalReason', severity: 'error' })
  }
  if (!constraint.createdBy.trim() || !constraint.approvedBy.trim()) {
    issues.push({ code: 'constraint.actor_required', message: 'אילוץ קשיח מחייב זהות יוצר ומאשר', severity: 'error' })
  }
  if (!constraint.approvedAt.trim()) {
    issues.push({ code: 'constraint.approval_time_required', message: 'אילוץ קשיח מחייב מועד אישור', path: 'approvedAt', severity: 'error' })
  }
  return issues
}
