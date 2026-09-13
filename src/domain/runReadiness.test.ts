import { describe, expect, it } from 'vitest'
import type { AssignmentRun } from './workflow'
import { runReadiness } from './runReadiness'

const assignment = (studentId: string, clusterId: string, rank = 1) => ({ studentId, clusterId, courseId: 'course', rank, source: 'ranked_choice' as const, aiPriority: 'neutral' as const, explanation: '' })
const run = (required: number, assignments: ReturnType<typeof assignment>[]): AssignmentRun => ({ id: 'run', executedAt: '', executedBy: '', algorithmVersion: 'negative-last-resort-1.1.0', seed: 42, assignments, enrollmentByCourse: {}, warnings: [], tieBreaks: [], includedStudentClusterCount: required })

describe('run readiness', () => {
  it('counts deliberate exclusions separately from missing assignments', () => {
    const result = runReadiness({ ...run(2, [assignment('a', 'one'), assignment('a', 'two')]), excludedStudentClusterCount: 3 })
    expect(result).toMatchObject({ required: 2, assigned: 2, missing: 0, excluded: 3, issues: [] })
  })
  it('blocks a run with missing or duplicate student-cluster pairs', () => {
    expect(runReadiness(run(3, [assignment('a', 'one'), assignment('b', 'one')])).missing).toBe(1)
    expect(runReadiness(run(2, [assignment('a', 'one'), assignment('a', 'one')])).issues).toContain('נמצא שיבוץ כפול של תלמיד באותו מקבץ.')
  })
})
