import { describe, expect, it } from 'vitest'
import type { ActorContext } from '../domain/access'
import { demoCatalogSnapshot, demoCycle, demoSubmission } from '../demo/demoCycle'
import { ConcurrentModificationError, DomainValidationError } from '../domain/types'
import { InMemoryNativRepository } from '../infrastructure/local/InMemoryNativRepository'
import { AuthorizationError, IdempotencyConflictError } from './errors'
import { NativCommandService } from './NativCommandService'

const coordinator: ActorContext = {
  uid: 'coordinator-1',
  organizationId: demoCycle.organizationId,
  roles: ['placement_coordinator'],
  capabilities: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.audit.view'],
}

const student: ActorContext = {
  uid: 'student-demo-001',
  organizationId: demoCycle.organizationId,
  roles: ['student'],
  capabilities: [],
}

function createDraft() {
  return {
    ...structuredClone(demoSubmission),
    id: 'draft-student-demo-001',
    version: 0,
    status: 'draft' as const,
    submissionVersion: 0,
    submittedAt: undefined,
  }
}

describe('NativCommandService cycle commands', () => {
  it('performs an authorized transition once and reuses an idempotent result', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] })
    const service = new NativCommandService(repository)
    const input = {
      organizationId: demoCycle.organizationId,
      cycleId: demoCycle.id,
      expectedVersion: demoCycle.version,
      to: 'choice_closed' as const,
      reason: 'תקופת הבחירה הסתיימה',
      occurredAt: '2026-08-28T12:00:00Z',
      idempotencyKey: 'cycle-close-1',
      auditEventId: 'audit-cycle-close-1',
    }
    const first = await service.transitionCycle(coordinator, input)
    const retry = await service.transitionCycle(coordinator, input)
    expect(first).toEqual(retry)
    expect(first).toMatchObject({ status: 'choice_closed', version: demoCycle.version + 1 })
    expect(await service.listAuditEvents(coordinator)).toHaveLength(1)
  })

  it('rejects an idempotency key reused for a different request', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] })
    const service = new NativCommandService(repository)
    const base = {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, expectedVersion: demoCycle.version,
      to: 'choice_closed' as const, reason: 'סגירה', occurredAt: '2026-08-28T12:00:00Z', idempotencyKey: 'same-key', auditEventId: 'audit-1',
    }
    await service.transitionCycle(coordinator, base)
    await expect(service.transitionCycle(coordinator, { ...base, reason: 'סיבה אחרת' })).rejects.toThrow(IdempotencyConflictError)
  })

  it('blocks a user without the management capability', async () => {
    const service = new NativCommandService(new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] }))
    await expect(service.transitionCycle(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, expectedVersion: demoCycle.version,
      to: 'choice_closed', reason: 'סגירה', occurredAt: '2026-08-28T12:00:00Z', idempotencyKey: 'student-close', auditEventId: 'audit-student-close',
    })).rejects.toThrow(AuthorizationError)
  })

  it('keeps optimistic concurrency checks inside the command transaction', async () => {
    const service = new NativCommandService(new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] }))
    await expect(service.transitionCycle(coordinator, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, expectedVersion: 0,
      to: 'choice_closed', reason: 'סגירה', occurredAt: '2026-08-28T12:00:00Z', idempotencyKey: 'stale-close', auditEventId: 'audit-stale-close',
    })).rejects.toThrow(ConcurrentModificationError)
  })
})

describe('NativCommandService preference commands', () => {
  it('saves an incomplete draft for the student and records an audit event', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] })
    const service = new NativCommandService(repository)
    const draft = createDraft()
    draft.preferences = []
    const saved = await service.saveDraft(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, studentId: student.uid,
      draft, expectedVersion: 0, occurredAt: '2026-08-28T09:00:00Z', idempotencyKey: 'save-draft-1', auditEventId: 'audit-save-draft-1',
    })
    expect(saved).toMatchObject({ status: 'draft', version: 1 })
    expect(await repository.transact((transaction) => transaction.listAuditEvents(demoCycle.organizationId))).toHaveLength(1)
  })

  it('submits an immutable version while preserving the draft', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] })
    const service = new NativCommandService(repository)
    const saved = await service.saveDraft(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, studentId: student.uid,
      draft: createDraft(), expectedVersion: 0, occurredAt: '2026-08-28T09:00:00Z', idempotencyKey: 'save-draft-2', auditEventId: 'audit-save-draft-2',
    })
    const submitted = await service.submitPreferences(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, studentId: student.uid,
      draftId: saved.id, expectedDraftVersion: saved.version, submittedSubmissionId: 'submission-student-demo-001-v1', submissionVersion: 1,
      occurredAt: '2026-08-28T09:05:00Z', idempotencyKey: 'submit-1', auditEventId: 'audit-submit-1',
    })
    const records = await repository.transact((transaction) => transaction.listSubmissions(demoCycle.organizationId, demoCycle.id))
    expect(submitted).toMatchObject({ status: 'submitted', submissionVersion: 1 })
    expect(records.map((record) => record.id)).toEqual(expect.arrayContaining([saved.id, submitted.id]))
  })

  it('rejects an incomplete draft at submission time', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle], catalogSnapshots: [demoCatalogSnapshot] })
    const service = new NativCommandService(repository)
    const draft = createDraft()
    draft.preferences = []
    const saved = await service.saveDraft(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, studentId: student.uid,
      draft, expectedVersion: 0, occurredAt: '2026-08-28T09:00:00Z', idempotencyKey: 'save-incomplete', auditEventId: 'audit-save-incomplete',
    })
    await expect(service.submitPreferences(student, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, studentId: student.uid,
      draftId: saved.id, expectedDraftVersion: saved.version, submittedSubmissionId: 'submission-invalid', submissionVersion: 1,
      occurredAt: '2026-08-28T09:05:00Z', idempotencyKey: 'submit-invalid', auditEventId: 'audit-submit-invalid',
    })).rejects.toThrow(DomainValidationError)
  })
})
