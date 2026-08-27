import type { Course } from './catalog'
import type { ValidationIssue } from './types'

export interface PolicyDecision {
  outcome: 'allowed' | 'warning' | 'approval_required' | 'blocked'
  issues: ValidationIssue[]
}

export function evaluateRepeatPolicy(course: Course, previouslyCompletedLogicalCourseIds: string[]): PolicyDecision {
  if (!previouslyCompletedLogicalCourseIds.includes(course.logicalCourseId)) {
    return { outcome: 'allowed', issues: [] }
  }

  switch (course.repeatPolicy) {
    case 'allowed':
      return { outcome: 'allowed', issues: [] }
    case 'discouraged':
      return { outcome: 'warning', issues: [{ code: 'assignment.repeat_discouraged', message: `חזרה על ${course.label} אינה מומלצת אך אפשרית`, severity: 'warning' }] }
    case 'approval_required':
      return { outcome: 'approval_required', issues: [{ code: 'assignment.repeat_approval_required', message: `חזרה על ${course.label} מחייבת אישור`, severity: 'warning' }] }
    case 'prohibited':
      return { outcome: 'blocked', issues: [{ code: 'assignment.repeat_prohibited', message: `מדיניות הקורס אוסרת חזרה על ${course.label}`, severity: 'error' }] }
  }
}

export interface CapacityDecision {
  outcome: 'within_capacity' | 'below_minimum' | 'above_target' | 'override_required'
  projectedEnrollment: number
  requiresSecondApprover: boolean
}

export function evaluateCapacity(course: Course, currentEnrollment: number, change: number): CapacityDecision {
  const projectedEnrollment = currentEnrollment + change
  if (projectedEnrollment > course.capacity.maximum) {
    return { outcome: 'override_required', projectedEnrollment, requiresSecondApprover: true }
  }
  if (projectedEnrollment < course.capacity.minimum) {
    return { outcome: 'below_minimum', projectedEnrollment, requiresSecondApprover: false }
  }
  if (projectedEnrollment > course.capacity.target) {
    return { outcome: 'above_target', projectedEnrollment, requiresSecondApprover: false }
  }
  return { outcome: 'within_capacity', projectedEnrollment, requiresSecondApprover: false }
}

export function canApproveCapacityOverride(executorId: string, approverId: string): boolean {
  return Boolean(executorId.trim() && approverId.trim() && executorId !== approverId)
}
