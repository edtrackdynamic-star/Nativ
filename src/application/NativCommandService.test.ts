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
  it('does not open an older draft with fewer than three rankings among three courses', async () => {
    const draftCycle = { ...demoCycle, status: 'draft' as const }
    const catalog = structuredClone(demoCatalogSnapshot)
    catalog.clusters[0].requiredRankingCount = 2
    const service = new NativCommandService(new InMemoryNativRepository({ cycles: [draftCycle], catalogSnapshots: [catalog] }))
    await expect(service.transitionCycle(coordinator, {
      organizationId: demoCycle.organizationId, cycleId: demoCycle.id, expectedVersion: draftCycle.version,
      to: 'choice_open', reason: 'פתיחת הבחירה', occurredAt: '2026-08-28T12:00:00Z', idempotencyKey: 'invalid-ranks-open', auditEventId: 'invalid-ranks-open-audit',
    })).rejects.toThrow(DomainValidationError)
  })

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
  it('blocks a draft after the deadline and accepts it again when the deadline is extended', async () => {
    const closed={...demoCycle,choiceDeadlineEnabled:true,choiceClosesAt:'2026-08-28T08:00:00.000Z'}
    const input={organizationId:demoCycle.organizationId,cycleId:demoCycle.id,studentId:student.uid,draft:createDraft(),expectedVersion:0,occurredAt:'2026-08-28T09:00:00.000Z',idempotencyKey:'deadline-draft',auditEventId:'deadline-audit'}
    const blocked=new NativCommandService(new InMemoryNativRepository({cycles:[closed],catalogSnapshots:[demoCatalogSnapshot]}))
    await expect(blocked.saveDraft(student,input)).rejects.toThrow(DomainValidationError)
    const extended=new NativCommandService(new InMemoryNativRepository({cycles:[{...closed,choiceClosesAt:'2026-08-29T08:00:00.000Z'}],catalogSnapshots:[demoCatalogSnapshot]}))
    await expect(extended.saveDraft(student,input)).resolves.toMatchObject({status:'draft'})
  })
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

describe('class scoped choices', () => {
  const restrictedCatalog = {...demoCatalogSnapshot,clusters:demoCatalogSnapshot.clusters.map((c,i)=>({...c,eligibleClassIds:[i===0?'a':'b']}))}
  const actor={...student,studentClassId:'a'}
  const base={organizationId:demoCycle.organizationId,cycleId:demoCycle.id,studentId:student.uid,occurredAt:'2026-09-09T12:00:00Z',idempotencyKey:'class-save',auditEventId:'class-audit'}
  it('filters the catalog and rejects forged clusters or duplicate preferences', async()=>{
    const service=new NativCommandService(new InMemoryNativRepository({cycles:[demoCycle],catalogSnapshots:[restrictedCatalog]}))
    const context=await service.getChoiceContext(actor,demoCycle.id)
    expect(context.catalog.clusters.map(c=>c.clusterId)).toEqual([restrictedCatalog.clusters[0].clusterId])
    expect((await service.getChoiceContext(student,demoCycle.id)).catalog.clusters).toEqual([])
    await expect(service.saveDraft(actor,{...base,draft:{...createDraft(),preferences:[{clusterId:'forged',rankings:[]}]},expectedVersion:0})).rejects.toThrow(DomainValidationError)
    const preference={clusterId:restrictedCatalog.clusters[0].clusterId,rankings:[]}
    await expect(service.saveDraft(actor,{...base,draft:{...createDraft(),preferences:[preference,preference]},expectedVersion:0})).rejects.toThrow(DomainValidationError)
  })
  it('requires a refreshed draft when the trusted class changes before submit',async()=>{
    const service=new NativCommandService(new InMemoryNativRepository({cycles:[demoCycle],catalogSnapshots:[restrictedCatalog]}))
    const draft=await service.saveDraft(actor,{...base,draft:{...createDraft(),preferences:createDraft().preferences.filter(p=>p.clusterId===restrictedCatalog.clusters[0].clusterId)},expectedVersion:0})
    expect(draft.catalogSnapshot).toHaveLength(1)
    await expect(service.submitPreferences({...actor,studentClassId:'b'},{...base,idempotencyKey:'submit-b',draftId:draft.id,expectedDraftVersion:draft.version,submittedSubmissionId:'submitted-b',submissionVersion:1})).rejects.toThrow(DomainValidationError)
    const submitted=await service.submitPreferences(actor,{...base,idempotencyKey:'submit-a',auditEventId:'submit-audit',draftId:draft.id,expectedDraftVersion:draft.version,submittedSubmissionId:'submitted-a',submissionVersion:1})
    expect(submitted.catalogSnapshot).toHaveLength(1)
  })
})
