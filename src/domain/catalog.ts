import type { ValidationIssue, VersionedEntity } from './types'
import type { ClusterSnapshot } from './preferences'

export const repeatPolicies = ['allowed', 'approval_required', 'discouraged', 'prohibited'] as const
export type RepeatPolicy = (typeof repeatPolicies)[number]

export interface Cluster extends VersionedEntity {
  cycleId: string
  label: string
  slot: string
  eligibleGradeIds: string[]
  displayOrder: number
  requiredRankingCount: number
  balanceByClass?: boolean
}

export interface CourseCapacity {
  minimum: number
  target: number
  maximum: number
}

export interface Course extends VersionedEntity {
  cycleId: string
  clusterId: string
  logicalCourseId: string
  label: string
  documentUrl?: string
  imageUrl?: string
  description: string
  subjectArea: string
  instructorIds: string[]
  slot: string
  eligibleGradeIds: string[]
  capacity: CourseCapacity
  repeatPolicy: RepeatPolicy
  repeatPolicyConsultedWith?: string
  published: boolean
}

export interface CycleCatalogSnapshot extends VersionedEntity {
  cycleId: string
  formDesign?: import('./formDesign').FormDesign
  clusters: ClusterSnapshot[]
}

export function validateCourse(course: Course): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { minimum, target, maximum } = course.capacity
  if (![minimum, target, maximum].every(Number.isInteger) || minimum < 0) {
    issues.push({ code: 'course.capacity.invalid_number', message: 'ערכי הקיבולת חייבים להיות מספרים שלמים ולא שליליים', path: 'capacity', severity: 'error' })
  }
  if (minimum > target || target > maximum) {
    issues.push({ code: 'course.capacity.invalid_order', message: 'נדרש מינימום ≤ יעד ≤ מקסימום', path: 'capacity', severity: 'error' })
  }
  if (!course.instructorIds.length) {
    issues.push({ code: 'course.instructor.missing', message: 'יש לשייך לפחות מנחה אחד לקורס', path: 'instructorIds', severity: 'error' })
  }
  if (course.repeatPolicy !== 'allowed' && !course.repeatPolicyConsultedWith?.trim()) {
    issues.push({ code: 'course.repeat_policy.consultation_missing', message: 'יש לתעד עם מי נקבעה מדיניות החזרה על הקורס', path: 'repeatPolicyConsultedWith', severity: 'warning' })
  }
  return issues
}
