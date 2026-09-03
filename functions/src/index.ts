import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { NativCommandService } from '../../src/application/NativCommandService'
import { AuthorizationError, EntityNotFoundError, IdempotencyConflictError } from '../../src/application/errors'
import { cycleStatuses } from '../../src/domain/cycle'
import type { ClusterPreference, PreferenceSubmission } from '../../src/domain/preferences'
import { ConcurrentModificationError, DomainValidationError } from '../../src/domain/types'
import { demoCatalogSnapshot, demoCourses, demoCycle } from '../../src/demo/demoCycle'
import { FirestoreNativRepository } from '../../server/firestore/FirestoreNativRepository'
import { catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath } from '../../server/firestore/paths'
import { callableOptions, nativFirestore as firestore } from './firebase'
import { actorFromRequest, inputRecord, requiredInteger, requiredString } from './request'

const service = new NativCommandService(new FirestoreNativRepository(firestore))

export { analyzeAppeal, approveAiEvaluation, approveAssignmentRun, decideAppeal, executeAppealChange, generateAiEvaluations, getWorkflow, publishAssignments, runAssignment, submitAppeal } from './workflowCallables'
export { claimInitialAccessManager, getMyNativAccess, listAccessUsers, setUserAccess } from './accessCallablesV2'
export { deliverNativMail } from './mailDelivery'

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error
  if (error instanceof AuthorizationError) throw new HttpsError('permission-denied', error.message)
  if (error instanceof EntityNotFoundError) throw new HttpsError('not-found', error.message)
  if (error instanceof ConcurrentModificationError || error instanceof IdempotencyConflictError) throw new HttpsError('aborted', error.message)
  if (error instanceof DomainValidationError) throw new HttpsError('failed-precondition', error.message, { issues: error.issues })
  console.error('Unexpected Nativ callable failure', error)
  throw new HttpsError('internal', 'הפעולה נכשלה')
}

function parsePreferences(value: unknown): ClusterPreference[] {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'נדרשת רשימת העדפות')
  return value as ClusterPreference[]
}

export const getPreparationStatus = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  return { status: process.env.FUNCTIONS_EMULATOR === 'true' ? 'local_mvp' : 'cloud_connected', organizationId: actor.organizationId, roles: actor.roles, accessMode: actor.accessMode, liveDataConnected: process.env.FUNCTIONS_EMULATOR !== 'true', edTrackDirectoryConnected: process.env.FUNCTIONS_EMULATOR !== 'true', geminiConnected: Boolean(process.env.NATIV_GEMINI_API_KEY) }
})

export const getCycle = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    if (actor.roles.includes('student')) {
      const snapshot = await firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get()
      if (!snapshot.exists) throw new HttpsError('not-found', 'המחזור לא נמצא')
      return snapshot.data()
    }
    return await service.getCycle(actor, cycleId)
  } catch (error) { return mapError(error) }
})

export const getChoiceContext = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    return await service.getChoiceContext(actor, requiredString(data, 'cycleId'))
  } catch (error) { return mapError(error) }
})

export const listMySubmissions = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    return await service.listMySubmissions(actor, requiredString(data, 'cycleId'))
  } catch (error) { return mapError(error) }
})

export const transitionCycle = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const to = requiredString(data, 'to')
    if (!cycleStatuses.includes(to as (typeof cycleStatuses)[number])) throw new HttpsError('invalid-argument', 'מצב המחזור אינו תקין')
    return await service.transitionCycle(actor, {
      organizationId: actor.organizationId,
      cycleId: requiredString(data, 'cycleId'),
      expectedVersion: requiredInteger(data, 'expectedVersion'),
      to: to as (typeof cycleStatuses)[number],
      reason: requiredString(data, 'reason'),
      occurredAt: new Date().toISOString(),
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const savePreferenceDraft = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    const occurredAt = new Date().toISOString()
    const draft: PreferenceSubmission = {
      id: `draft-${cycleId}-${actor.uid}`,
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      submissionVersion: 0,
      status: 'draft',
      source: 'nativ_app',
      catalogSnapshot: [],
      preferences: parsePreferences(data.preferences),
      version: 0,
      createdAt: occurredAt,
      createdBy: actor.uid,
      updatedAt: occurredAt,
      updatedBy: actor.uid,
    }
    return await service.saveDraft(actor, {
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      draft,
      expectedVersion: requiredInteger(data, 'expectedVersion'),
      occurredAt,
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const submitPreferences = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    const submissionVersion = requiredInteger(data, 'submissionVersion')
    return await service.submitPreferences(actor, {
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      draftId: `draft-${cycleId}-${actor.uid}`,
      expectedDraftVersion: requiredInteger(data, 'expectedDraftVersion'),
      submittedSubmissionId: `submission-${cycleId}-${actor.uid}-v${submissionVersion}`,
      submissionVersion,
      occurredAt: new Date().toISOString(),
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const listAuditEvents = onCall(callableOptions, async (request) => {
  try { return await service.listAuditEvents(await actorFromRequest(request, 'read')) }
  catch (error) { return mapError(error) }
})

const demoAccounts = [
  {
    label: 'מנהל גישה', email: 'access@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['access_manager'], capabilities: ['nativ.access.manage'] },
  },
  {
    label: 'רכז שיבוץ', email: 'coordinator@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['placement_coordinator', 'appeal_reviewer'], capabilities: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.audit.view'] },
  },
  {
    label: 'תלמיד', email: 'student@nativ.demo', password: 'NativDemo!2026', uid: 'student-demo-001',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['student'], capabilities: [] },
  },
  {
    label: 'בודקת ערעורים', email: 'appeals@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['appeal_reviewer'], capabilities: ['nativ.assignment.view', 'nativ.appeal.review'] },
  },
  {
    label: 'מזכירות', email: 'secretary@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['secretary'], capabilities: [] },
  },
] as const

export const seedDemoEnvironment = onCall(callableOptions, async () => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new HttpsError('failed-precondition', 'הפעולה זמינה באמולטור בלבד')
  const auth = getAuth()
  for (const account of demoAccounts) {
    let user
    try {
      user = await auth.getUserByEmail(account.email)
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'auth/user-not-found') throw error
      user = await auth.createUser({ email: account.email, password: account.password, displayName: account.label, ...('uid' in account ? { uid: account.uid } : {}) })
    }
    await auth.setCustomUserClaims(user.uid, account.claims)
  }
  const cycleReference = firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id))
  const catalogReference = firestore.doc(catalogSnapshotDocumentPath(demoCycle.organizationId, demoCycle.id))
  const courseCatalogReference = firestore.doc(courseCatalogDocumentPath(demoCycle.organizationId, demoCycle.id))
  await firestore.runTransaction(async (transaction) => {
    const [cycleSnapshot, catalogSnapshot, courseCatalogSnapshot] = await transaction.getAll(cycleReference, catalogReference, courseCatalogReference)
    if (!cycleSnapshot.exists) transaction.create(cycleReference, demoCycle)
    if (!catalogSnapshot.exists) transaction.create(catalogReference, demoCatalogSnapshot)
    if (!courseCatalogSnapshot.exists) transaction.create(courseCatalogReference, { cycleId: demoCycle.id, organizationId: demoCycle.organizationId, courses: demoCourses })
  })
  return { cycleId: demoCycle.id, accounts: demoAccounts.map(({ label, email, password }) => ({ label, email, password })) }
})
