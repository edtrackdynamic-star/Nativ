import { describe, expect, it } from 'vitest'
import type { AssignmentCycle } from '../domain/cycle'
import type { WorkflowState } from '../domain/workflow'
import { coordinatorStageProgress } from './coordinatorStages'

const cycle = { id: 'cycle', organizationId: 'school', version: 1, schoolYear: '2026-2027', termLabel: 'א', status: 'choice_open', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', appealWindowSchoolDays: 5, rulesVersion: '1' } as AssignmentCycle
const workflow = { id: 'workflow', organizationId: 'school', version: 1, cycleId: 'cycle', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', aiEvaluations: [], appeals: [], notifications: [], history: [] } as WorkflowState

describe('coordinator stage progress', () => {
  it('shows the choice stage and explains an expired deadline without claiming submissions are complete', () => {
    const progress = coordinatorStageProgress({ ...cycle, choiceDeadlineEnabled: true, choiceClosesAt: '2026-09-01T00:00:00Z' }, workflow, Date.parse('2026-09-13T00:00:00Z'))
    expect(progress.current).toBe('students')
    expect(progress.next).toContain('מועד ההגשה חלף')
    expect(progress.stages[0].state).toBe('current')
    expect(progress.stages[1].state).toBe('upcoming')
  })

  it('keeps the review active until all recommendations are approved', () => {
    const progress = coordinatorStageProgress({ ...cycle, status: 'choice_closed' }, { ...workflow, aiBatchCreatedAt: '2026-09-12', aiEvaluations: [{ approved: undefined }] as WorkflowState['aiEvaluations'] }, Date.now())
    expect(progress.current).toBe('evaluations')
    expect(progress.approved).toBe(false)
    expect(progress.stages[0].state).toBe('complete')
    expect(progress.next).toContain('הממתינות')
  })

  it('points to appeals with outstanding requests and to delivery after they are resolved', () => {
    const published = { ...workflow, assignmentRun: { publishedAt: '2026-09-12' } as WorkflowState['assignmentRun'], appeals: [{ status: 'submitted' }] as WorkflowState['appeals'] }
    const active = coordinatorStageProgress({ ...cycle, status: 'appeals' }, published, Date.now())
    expect(active.current).toBe('appeals')
    expect(active.openAppeals).toBe(1)
    const resolved = coordinatorStageProgress({ ...cycle, status: 'appeals' }, { ...published, appeals: [{ status: 'executed' }] as WorkflowState['appeals'] }, Date.now())
    expect(resolved.current).toBe('delivery')
    expect(resolved.stages.find((stage) => stage.id === 'delivery')?.state).toBe('current')
    expect(resolved.stages.find((stage) => stage.id === 'actual')?.state).toBe('available')
  })

  it('makes delivery available after publication without implying that email was delivered', () => {
    const progress = coordinatorStageProgress({ ...cycle, status: 'published' }, { ...workflow, assignmentRun: { publishedAt: '2026-09-12' } as WorkflowState['assignmentRun'] }, Date.now())
    expect(progress.current).toBe('actual')
    expect(progress.stages.find((stage) => stage.id === 'delivery')?.state).toBe('available')
    expect(progress.stages.find((stage) => stage.id === 'appeals')?.state).toBe('upcoming')
  })
})
