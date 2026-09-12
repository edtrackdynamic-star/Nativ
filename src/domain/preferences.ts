import type { AssignmentCycle } from './cycle'
import { choiceAcceptsResponses } from './choiceDeadline'
import type { ValidationIssue, VersionedEntity } from './types'

export const submissionStatuses = ['draft', 'submitted'] as const
export type SubmissionStatus = (typeof submissionStatuses)[number]

export interface CourseSnapshot {
  description?: string
  documentUrl?: string
  imageUrl?: string
  instructorNames?: string[]
  courseId: string
  logicalCourseId: string
  label: string
}

export interface ClusterSnapshot {
  capacityFlexibility?: number
  eligibleClassIds?: string[]
  description?: string
  rationaleMode?: 'optional' | 'required' | 'hidden'
  clusterId: string
  label: string
  requiredRankingCount: number
  balanceByClass?: boolean
  courses: CourseSnapshot[]
}

export interface CourseRanking {
  courseId: string
  rank: number
}

export interface ClusterPreference {
  clusterId: string
  rankings: CourseRanking[]
  rationale?: string
}

export interface PreferenceSubmission extends VersionedEntity {
  cycleId: string
  studentId: string
  submissionVersion: number
  status: SubmissionStatus
  source: 'nativ_app' | 'google_forms_import'
  submittedAt?: string
  catalogSnapshot: ClusterSnapshot[]
  preferences: ClusterPreference[]
  usedInAssignmentRunId?: string
  aiEvaluationBatchId?: string
}

export function validatePreferenceSubmission(submission: PreferenceSubmission, cycle: AssignmentCycle): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (submission.organizationId !== cycle.organizationId || submission.cycleId !== cycle.id) {
    issues.push({ code: 'submission.cycle_scope_mismatch', message: 'ההגשה אינה שייכת למחזור ולארגון הפעילים', severity: 'error' })
  }
  if (submission.status === 'submitted' && !choiceAcceptsResponses(cycle, submission.submittedAt ?? submission.updatedAt)) {
    issues.push({ code: 'submission.choice_not_open', message: 'מועד הגשת הבחירות הסתיים או שתקופת הבחירה סגורה', severity: 'error' })
  }

  for (const cluster of submission.catalogSnapshot) {
    const preference = submission.preferences.find((entry) => entry.clusterId === cluster.clusterId)
    if (!preference) {
      issues.push({ code: 'submission.cluster_missing', message: `חסרות העדפות במקבץ ${cluster.label}`, path: `preferences.${cluster.clusterId}`, severity: 'error' })
      continue
    }
    if (submission.status === 'submitted' && cluster.rationaleMode === 'required' && !preference.rationale?.trim()) issues.push({ code: 'submission.rationale_required', message: `יש למלא נימוק במקבץ ${cluster.label}`, severity: 'error' })
    const expectedCourseIds = new Set(cluster.courses.map((course) => course.courseId))
    const rankedCourseIds = preference.rankings.map((ranking) => ranking.courseId)
    const uniqueCourseIds = new Set(rankedCourseIds)
    const ranks = preference.rankings.map((ranking) => ranking.rank).sort((a, b) => a - b)
    const expectedRanks = Array.from({ length: cluster.requiredRankingCount }, (_, index) => index + 1)

    if (preference.rankings.length !== cluster.requiredRankingCount) {
      issues.push({ code: 'submission.ranking_count', message: `במקבץ ${cluster.label} נדרשים ${cluster.requiredRankingCount} דירוגים`, path: `preferences.${cluster.clusterId}.rankings`, severity: 'error' })
    }
    if (uniqueCourseIds.size !== rankedCourseIds.length) {
      issues.push({ code: 'submission.duplicate_course', message: `אותו קורס דורג יותר מפעם אחת במקבץ ${cluster.label}`, path: `preferences.${cluster.clusterId}.rankings`, severity: 'error' })
    }
    if (rankedCourseIds.some((courseId) => !expectedCourseIds.has(courseId))) {
      issues.push({ code: 'submission.course_not_in_snapshot', message: `דורג קורס שלא היה זמין בצילום המקבץ ${cluster.label}`, path: `preferences.${cluster.clusterId}.rankings`, severity: 'error' })
    }
    if (ranks.length !== expectedRanks.length || ranks.some((rank, index) => rank !== expectedRanks[index])) {
      issues.push({ code: 'submission.rank_sequence', message: `הדירוגים במקבץ ${cluster.label} חייבים להיות רצף מלא ללא כפילויות`, path: `preferences.${cluster.clusterId}.rankings`, severity: 'error' })
    }
  }
  return issues
}
