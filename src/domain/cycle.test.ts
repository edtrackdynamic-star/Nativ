import { describe, expect, it } from 'vitest'
import { canTransitionCycle, transitionCycle, type AssignmentCycle } from './cycle'
import { ConcurrentModificationError, DomainValidationError } from './types'

const cycle: AssignmentCycle = {
  id: 'cycle-1', organizationId: 'org-1', version: 1,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-1', updatedAt: '2026-08-27T10:00:00Z', updatedBy: 'coordinator-1',
  schoolYear: 'תשפ״ז', termLabel: 'מחצית א׳', status: 'draft', appealWindowSchoolDays: 5, rulesVersion: '1.0.0',
}

describe('assignment cycle lifecycle', () => {
  it('allows only the approved forward lifecycle', () => {
    expect(canTransitionCycle('draft', 'choice_open')).toBe(true)
    expect(canTransitionCycle('draft', 'published')).toBe(false)
    expect(canTransitionCycle('closed', 'choice_open')).toBe(false)
  })

  it('increments the version and creates an audit event', () => {
    const result = transitionCycle(cycle, { expectedVersion: 1, to: 'choice_open', actorId: 'coordinator-1', occurredAt: '2026-08-28T08:00:00Z', reason: 'הטופס מוכן ונבדק', auditEventId: 'audit-1' })
    expect(result.cycle).toMatchObject({ status: 'choice_open', version: 2 })
    expect(result.auditEvent).toMatchObject({ beforeVersion: 1, afterVersion: 2, actorId: 'coordinator-1' })
  })

  it('blocks a stale concurrent write', () => {
    expect(() => transitionCycle(cycle, { expectedVersion: 0, to: 'choice_open', actorId: 'coordinator-1', occurredAt: '2026-08-28T08:00:00Z', reason: 'פתיחה', auditEventId: 'audit-1' })).toThrow(ConcurrentModificationError)
  })

  it('requires a reason for a lifecycle change', () => {
    expect(() => transitionCycle(cycle, { expectedVersion: 1, to: 'choice_open', actorId: 'coordinator-1', occurredAt: '2026-08-28T08:00:00Z', reason: ' ', auditEventId: 'audit-1' })).toThrow(DomainValidationError)
  })
})
