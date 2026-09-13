import assert from 'node:assert/strict'
import { it } from 'vitest'
import { buildDemoPreferencePlan, demoOrganizationId } from './demo-preference-plan.mjs'
import { validatePreferenceSubmission } from '../src/domain/preferences.ts'

const now = '2026-09-13T10:00:00.000Z'
const cycle = { id: 'cycle-test', organizationId: demoOrganizationId, status: 'choice_open' }
const catalog = { organizationId: demoOrganizationId, cycleId: cycle.id, clusters: [{
  clusterId: 'cluster-1', label: 'קורסי בחירה', requiredRankingCount: 3, eligibleClassIds: ['class-a'],
  courses: ['first', 'second', 'third'].map((id) => ({ courseId: id, logicalCourseId: id, label: id })),
}] }
const members = ['demo-student-01', 'demo-student-02', 'demo-student-03'].map((id) => ({ id, active: true, role: 'student', isDemo: true, classIds: ['class-a'] }))
const profiles = new Map(members.map((entry) => [entry.id, { classId: 'class-a' }]))
const previous = [{ cycleId: cycle.id, studentId: 'demo-student-01', status: 'submitted', preferences: [{ clusterId: 'cluster-1', rankings: [{ courseId: 'first', rank: 1 }] }] }]

it('plans varied valid rankings for missing demo students and leaves existing submissions untouched', () => {
  const plan = buildDemoPreferencePlan({ cycle, catalog, members, profiles, submissions: previous, now })
  assert.equal(plan.activeStudentCount, 3)
  assert.equal(plan.alreadySubmittedCount, 1)
  assert.deepEqual(plan.candidates.map((entry) => entry.studentId), ['demo-student-02', 'demo-student-03'])
  assert.notEqual(plan.candidates[0].preferences[0].rankings[0].courseId, plan.candidates[1].preferences[0].rankings[0].courseId)
  assert.equal(plan.candidates[0].source, 'demo_seed')
  assert.equal(plan.candidates[0].preferences[0].rationale, undefined)
  for (const candidate of plan.candidates) {
    assert.deepEqual(validatePreferenceSubmission({ ...candidate, version: 1, submittedAt: now, createdAt: now, updatedAt: now, createdBy: 'demo-preference-seed', updatedBy: 'demo-preference-seed' }, cycle), [])
  }
  assert.deepEqual(previous[0].preferences[0].rankings, [{ courseId: 'first', rank: 1 }])
})

it('rejects real accounts, closed periods, and clusters requiring personal explanations', () => {
  const input = { cycle, catalog, members, profiles, submissions: previous, now }
  assert.throws(() => buildDemoPreferencePlan({ ...input, members: [{ ...members[1], isDemo: false }] }), /not marked as demo/)
  assert.throws(() => buildDemoPreferencePlan({ ...input, cycle: { ...cycle, status: 'assignment' } }), /closed/)
  assert.throws(() => buildDemoPreferencePlan({ ...input, catalog: { ...catalog, clusters: [{ ...catalog.clusters[0], rationaleMode: 'required' }] } }), /personal explanation/)
  assert.throws(() => buildDemoPreferencePlan({ ...input, members: [{ ...members[1], classIds: [] }], profiles: new Map() }), /source class/)
})
