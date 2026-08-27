import { describe, expect, it } from 'vitest'
import type { AssignmentCycle } from './cycle'
import { validatePreferenceSubmission, type PreferenceSubmission } from './preferences'

const cycle: AssignmentCycle = {
  id: 'cycle-1', organizationId: 'org-1', version: 2,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-1', updatedAt: '2026-08-28T08:00:00Z', updatedBy: 'coordinator-1',
  schoolYear: 'תשפ״ז', termLabel: 'מחצית א׳', status: 'choice_open', appealWindowSchoolDays: 5, rulesVersion: '1.0.0',
}

function validSubmission(): PreferenceSubmission {
  return {
    id: 'submission-1', organizationId: 'org-1', version: 1,
    createdAt: '2026-08-28T09:00:00Z', createdBy: 'student-1', updatedAt: '2026-08-28T09:00:00Z', updatedBy: 'student-1',
    cycleId: 'cycle-1', studentId: 'student-1', submissionVersion: 1, status: 'submitted', source: 'nativ_app', submittedAt: '2026-08-28T09:00:00Z',
    catalogSnapshot: [{ clusterId: 'cluster-1', label: 'אמנויות', requiredRankingCount: 3, courses: [
      { courseId: 'course-1', logicalCourseId: 'theater', label: 'תיאטרון' },
      { courseId: 'course-2', logicalCourseId: 'music', label: 'מוזיקה' },
      { courseId: 'course-3', logicalCourseId: 'art', label: 'אמנות' },
    ] }],
    preferences: [{ clusterId: 'cluster-1', rankings: [
      { courseId: 'course-1', rank: 1 }, { courseId: 'course-2', rank: 2 }, { courseId: 'course-3', rank: 3 },
    ] }],
  }
}

describe('preference submission validation', () => {
  it('accepts a complete ranking without a rationale', () => {
    expect(validatePreferenceSubmission(validSubmission(), cycle)).toEqual([])
  })

  it('rejects duplicate ranks', () => {
    const submission = validSubmission()
    submission.preferences[0].rankings[1].rank = 1
    expect(validatePreferenceSubmission(submission, cycle).map((issue) => issue.code)).toContain('submission.rank_sequence')
  })

  it('rejects a course that was not in the immutable catalog snapshot', () => {
    const submission = validSubmission()
    submission.preferences[0].rankings[2].courseId = 'course-unknown'
    expect(validatePreferenceSubmission(submission, cycle).map((issue) => issue.code)).toContain('submission.course_not_in_snapshot')
  })

  it('rejects submission when the choice window is closed', () => {
    expect(validatePreferenceSubmission(validSubmission(), { ...cycle, status: 'choice_closed' }).map((issue) => issue.code)).toContain('submission.choice_not_open')
  })
})
