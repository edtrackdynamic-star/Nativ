import { readFileSync } from 'node:fs'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NativCommandService } from '../../src/application/NativCommandService'
import type { ActorContext } from '../../src/domain/access'
import { ConcurrentModificationError } from '../../src/domain/types'
import { demoCatalogSnapshot, demoCycle, demoSubmission } from '../../src/demo/demoCycle'
import { AuthorizationError } from '../../src/application/errors'
import { FirestoreNativRepository } from './FirestoreNativRepository'
import { auditEventDocumentPath, catalogSnapshotDocumentPath, cycleDocumentPath, idempotencyDocumentPath, submissionDocumentPath } from './paths'

const projectId = 'demo-nativ-local'

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

const accessManager: ActorContext = {
  uid: 'access-manager-1',
  organizationId: demoCycle.organizationId,
  roles: ['access_manager'],
  capabilities: ['nativ.access.manage'],
}

function draftSubmission() {
  return {
    ...structuredClone(demoSubmission),
    id: 'draft-student-demo-001',
    version: 0,
    submissionVersion: 0,
    status: 'draft' as const,
    submittedAt: undefined,
  }
}

function transitionInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: demoCycle.organizationId,
    cycleId: demoCycle.id,
    expectedVersion: demoCycle.version,
    to: 'choice_closed' as const,
    reason: 'סיום תקופת הבחירה',
    occurredAt: '2026-08-28T14:00:00Z',
    idempotencyKey: 'close-cycle-emulator',
    auditEventId: 'audit-close-cycle-emulator',
    ...overrides,
  }
}

describe('FirestoreNativRepository and locked rules', () => {
  let adminApp: App
  let firestore: Firestore
  let repository: FirestoreNativRepository
  let testEnvironment: RulesTestEnvironment

  beforeAll(async () => {
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
    if (!emulatorHost) throw new Error('בדיקות אלה חייבות לרוץ דרך Firebase Emulator Suite')
    const separator = emulatorHost.lastIndexOf(':')
    const host = emulatorHost.slice(0, separator)
    const port = Number(emulatorHost.slice(separator + 1))
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
    testEnvironment = await initializeTestEnvironment({ projectId, firestore: { host, port, rules } })
    adminApp = initializeApp({ projectId }, 'nativ-firestore-emulator-tests')
    firestore = getFirestore(adminApp)
    repository = new FirestoreNativRepository(firestore)
  })

  beforeEach(async () => {
    await testEnvironment.clearFirestore()
    await firestore.doc(catalogSnapshotDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCatalogSnapshot)
  })

  afterAll(async () => {
    await testEnvironment?.cleanup()
    if (adminApp) await deleteApp(adminApp)
  })

  it('denies all direct client reads and writes, regardless of authentication or claims', async () => {
    const path = submissionDocumentPath(demoCycle.organizationId, 'draft-student-demo-001')
    const unauthenticated = testEnvironment.unauthenticatedContext().firestore()
    const authenticated = testEnvironment.authenticatedContext(student.uid, {
      organizationId: demoCycle.organizationId,
      capabilities: ['nativ.assignment.manage'],
    }).firestore()

    await assertFails(getDoc(doc(unauthenticated, path)))
    await assertFails(setDoc(doc(authenticated, path), { studentId: student.uid, status: 'draft' }))
    await assertFails(getDoc(doc(authenticated, path)))
  })

  it('persists one authorized transition atomically and reuses its idempotent result', async () => {
    await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCycle)
    const service = new NativCommandService(repository)

    const first = await service.transitionCycle(coordinator, transitionInput())
    const retry = await service.transitionCycle(coordinator, transitionInput())

    expect(retry).toEqual(first)
    expect(first).toMatchObject({ status: 'choice_closed', version: 2 })
    expect((await firestore.doc(auditEventDocumentPath(demoCycle.organizationId, 'audit-close-cycle-emulator')).get()).exists).toBe(true)
    expect((await firestore.doc(idempotencyDocumentPath(demoCycle.organizationId, 'close-cycle-emulator')).get()).exists).toBe(true)
  })

  it('isolates identical cycle identifiers in different organizations', async () => {
    const otherOrganizationId = 'org-other'
    await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCycle)
    await firestore.doc(cycleDocumentPath(otherOrganizationId, demoCycle.id)).set({ ...demoCycle, organizationId: otherOrganizationId })
    const service = new NativCommandService(repository)

    await service.transitionCycle(coordinator, transitionInput())

    const otherCycle = (await firestore.doc(cycleDocumentPath(otherOrganizationId, demoCycle.id)).get()).data()
    expect(otherCycle).toMatchObject({ organizationId: otherOrganizationId, status: 'choice_open', version: 1 })
  })

  it('allows a student to save and submit only their own preferences while preserving the draft', async () => {
    await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCycle)
    const service = new NativCommandService(repository)
    const draft = draftSubmission()

    const saved = await service.saveDraft(student, {
      organizationId: demoCycle.organizationId,
      cycleId: demoCycle.id,
      studentId: student.uid,
      draft,
      expectedVersion: 0,
      occurredAt: '2026-08-28T14:05:00Z',
      idempotencyKey: 'save-own-draft-emulator',
      auditEventId: 'audit-save-own-draft-emulator',
    })

    expect(saved).toMatchObject({ studentId: student.uid, status: 'draft', version: 1 })
    expect((await firestore.doc(submissionDocumentPath(demoCycle.organizationId, draft.id)).get()).exists).toBe(true)

    const submitted = await service.submitPreferences(student, {
      organizationId: demoCycle.organizationId,
      cycleId: demoCycle.id,
      studentId: student.uid,
      draftId: saved.id,
      expectedDraftVersion: saved.version,
      submittedSubmissionId: 'submission-student-demo-001-v1',
      submissionVersion: 1,
      occurredAt: '2026-08-28T14:05:30Z',
      idempotencyKey: 'submit-own-preferences-emulator',
      auditEventId: 'audit-submit-own-preferences-emulator',
    })
    const storedSubmissions = await repository.transact((transaction) => transaction.listSubmissions(demoCycle.organizationId, demoCycle.id))
    expect(submitted).toMatchObject({ status: 'submitted', submissionVersion: 1 })
    expect(storedSubmissions.map((submission) => submission.id)).toEqual(expect.arrayContaining([saved.id, submitted.id]))

    await expect(service.saveDraft(student, {
      organizationId: demoCycle.organizationId,
      cycleId: demoCycle.id,
      studentId: 'student-other',
      draft: { ...draft, id: 'draft-other', studentId: 'student-other' },
      expectedVersion: 0,
      occurredAt: '2026-08-28T14:06:00Z',
      idempotencyKey: 'save-other-draft-emulator',
      auditEventId: 'audit-save-other-draft-emulator',
    })).rejects.toThrow(AuthorizationError)
  })

  it('keeps access management separate from professional placement permissions', async () => {
    await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCycle)
    const service = new NativCommandService(repository)
    await expect(service.transitionCycle(accessManager, transitionInput({ idempotencyKey: 'access-manager-close' }))).rejects.toThrow(AuthorizationError)
  })

  it('rejects a stale version and rolls back the entity when the audit append fails', async () => {
    await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).set(demoCycle)
    const service = new NativCommandService(repository)

    await expect(service.transitionCycle(coordinator, transitionInput({ expectedVersion: 0, idempotencyKey: 'stale-cycle' }))).rejects.toThrow(ConcurrentModificationError)

    const duplicateAuditId = 'audit-already-exists'
    await firestore.doc(auditEventDocumentPath(demoCycle.organizationId, duplicateAuditId)).set({ id: duplicateAuditId })
    await expect(service.transitionCycle(coordinator, transitionInput({
      idempotencyKey: 'rollback-cycle',
      auditEventId: duplicateAuditId,
    }))).rejects.toBeTruthy()

    const storedCycle = (await firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id)).get()).data()
    expect(storedCycle).toMatchObject({ status: 'choice_open', version: 1 })
    expect((await firestore.doc(idempotencyDocumentPath(demoCycle.organizationId, 'rollback-cycle')).get()).exists).toBe(false)
  })
})
