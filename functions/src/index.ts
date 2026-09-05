import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { NativCommandService } from '../../src/application/NativCommandService'
import { AuthorizationError, EntityNotFoundError, IdempotencyConflictError } from '../../src/application/errors'
import { cycleStatuses, type AssignmentCycle } from '../../src/domain/cycle'
import type { ClusterPreference, PreferenceSubmission } from '../../src/domain/preferences'
import type { Course, CycleCatalogSnapshot, RepeatPolicy } from '../../src/domain/catalog'
import type { WorkflowState } from '../../src/domain/workflow'
import { ConcurrentModificationError, DomainValidationError } from '../../src/domain/types'
import { demoCatalogSnapshot, demoCourses, demoCycle } from '../../src/demo/demoCycle'
import { FirestoreNativRepository } from '../../server/firestore/FirestoreNativRepository'
import { catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath, workflowDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore as firestore } from './firebase'
import { actorFromRequest, inputRecord, requiredInteger, requiredString } from './request'

const service = new NativCommandService(new FirestoreNativRepository(firestore))

export { analyzeAppeal, approveAiEvaluation, approveAssignmentRun, approveCapacityOverride, decideAppeal, executeAppealChange, generateAiEvaluations, getWorkflow, publishAssignments, recommendAppeal, runAssignment, submitAppeal } from './workflowCallables'
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
  return { status: process.env.FUNCTIONS_EMULATOR === 'true' ? 'local_mvp' : 'cloud_connected', organizationId: actor.organizationId, roles: actor.roles, accessMode: actor.accessMode, liveDataConnected: process.env.FUNCTIONS_EMULATOR !== 'true', edTrackDirectoryConnected: process.env.FUNCTIONS_EMULATOR !== 'true', geminiConnected: false }
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

export const listCycles = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.roles.length) throw new HttpsError('permission-denied', 'לא הוקצה תפקיד בנתיב')
  const snapshot = await firestore.collection(`organizations/${actor.organizationId}/nativCycles`).limit(50).get()
  const cycles = snapshot.docs.map((entry) => entry.data() as AssignmentCycle)
  if (actor.roles.includes('student') && !actor.capabilities.includes('nativ.assignment.view')) return cycles.filter((cycle) => ['choice_open', 'published', 'appeals', 'closed'].includes(cycle.status)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return cycles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

export const createCycle = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה להקים מחזור')
  const data = inputRecord(request.data)
  const schoolYear = requiredString(data, 'schoolYear')
  const termLabel = requiredString(data, 'termLabel')
  const now = new Date().toISOString()
  const id = `cycle-${randomUUID()}`
  const cycle: AssignmentCycle = { id, organizationId: actor.organizationId, schoolYear, termLabel, status: 'draft', appealWindowSchoolDays: 5, rulesVersion: '1.0.0', version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
  const batch = firestore.batch()
  batch.create(firestore.doc(cycleDocumentPath(actor.organizationId, id)), cycle)
  batch.create(firestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'cycle.created', entityType: 'AssignmentCycle', entityId: id, reason: `הקמת מחזור ${schoolYear} ${termLabel}`, afterVersion: 1 })
  await batch.commit()
  return cycle
})

interface CatalogCourseInput { label: string; description?: string; subjectArea?: string; instructorIds: string[]; minimum: number; target: number; maximum: number; repeatPolicy: RepeatPolicy }
interface CatalogClusterInput { label: string; requiredRankingCount: number; courses: CatalogCourseInput[] }

export const saveCycleCatalog = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לעדכן קורסים')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  if (!Array.isArray(data.clusters) || !data.clusters.length) throw new HttpsError('invalid-argument', 'נדרש לפחות מקבץ אחד')
  const clusters = data.clusters as CatalogClusterInput[]
  const now = new Date().toISOString()
  const base = { organizationId: actor.organizationId, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
  const courses: Course[] = []
  const catalogClusters = clusters.map((cluster, clusterIndex) => {
    const label = typeof cluster.label === 'string' ? cluster.label.trim() : ''
    if (!label || !Number.isInteger(cluster.requiredRankingCount) || !Array.isArray(cluster.courses) || cluster.courses.length < cluster.requiredRankingCount) throw new HttpsError('invalid-argument', 'יש להשלים את שם המקבץ ומספר הקורסים לדירוג')
    const clusterId = `cluster-${randomUUID()}`
    const snapshotCourses = cluster.courses.map((course) => {
      const courseLabel = typeof course.label === 'string' ? course.label.trim() : ''
      const instructorIds = Array.isArray(course.instructorIds) ? course.instructorIds.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : []
      if (!courseLabel || !instructorIds.length || ![course.minimum, course.target, course.maximum].every(Number.isInteger) || course.minimum < 0 || course.minimum > course.target || course.target > course.maximum) throw new HttpsError('invalid-argument', `יש להשלים מנחה וקיבולת תקינה בקורס ${courseLabel || 'ללא שם'}`)
      if (!['allowed', 'approval_required', 'discouraged', 'prohibited'].includes(course.repeatPolicy)) throw new HttpsError('invalid-argument', 'מדיניות החזרה אינה תקינה')
      const courseId = `course-${randomUUID()}`
      courses.push({ ...base, id: courseId, cycleId, clusterId, logicalCourseId: courseId, label: courseLabel, description: String(course.description ?? '').trim(), subjectArea: String(course.subjectArea ?? '').trim(), instructorIds, slot: `slot-${clusterIndex + 1}`, eligibleGradeIds: [], capacity: { minimum: course.minimum, target: course.target, maximum: course.maximum }, repeatPolicy: course.repeatPolicy, published: true })
      return { courseId, logicalCourseId: courseId, label: courseLabel }
    })
    return { clusterId, label, requiredRankingCount: cluster.requiredRankingCount, courses: snapshotCourses }
  })
  const catalog: CycleCatalogSnapshot = { ...base, id: `catalog-${cycleId}`, cycleId, clusters: catalogClusters }
  return firestore.runTransaction(async (transaction) => {
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const cycleSnapshot = await transaction.get(cycleReference)
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    if (cycle?.status !== 'draft') throw new HttpsError('failed-precondition', 'ניתן לערוך קורסים רק לפני פתיחת הבחירה')
    transaction.set(firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)), catalog)
    transaction.set(firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)), { organizationId: actor.organizationId, cycleId, courses, updatedAt: now, updatedBy: actor.uid })
    transaction.set(cycleReference, { ...cycle, version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid })
    transaction.create(firestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'catalog.saved', entityType: 'AssignmentCycle', entityId: cycleId, reason: `שמירת ${catalogClusters.length} מקבצים ו-${courses.length} קורסים`, beforeVersion: cycle.version, afterVersion: cycle.version + 1 })
    return catalog
  })
})

export const listEligibleInstructors = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לצפות ברשימת המנחים')
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const result = await getAuth().listUsers(1000)
    return result.users.filter((user) => user.customClaims?.organizationId === actor.organizationId && !user.customClaims?.roles?.includes('student')).map((user) => ({ uid: user.uid, displayName: user.displayName || user.email || 'חבר צוות' }))
  }
  const members = await coreFirestore.collection(`organizations/${actor.organizationId}/members`).where('active', '==', true).limit(1000).get()
  return members.docs.filter((member) => member.data().role !== 'student').map((member) => ({ uid: member.id, displayName: String(member.data().fullName ?? member.data().email ?? 'חבר צוות') }))
})

export const getCycleCatalog = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לצפות בהגדרות המחזור')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [catalog, courses] = await Promise.all([firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(), firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get()])
  return { catalog: catalog.exists ? catalog.data() : null, courses: courses.exists ? courses.data()?.courses ?? [] : [] }
})

export const getInstructorWorkspace = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.roles.includes('course_instructor')) throw new HttpsError('permission-denied', 'המסך זמין למנחי קורסים בלבד')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [cycleSnapshot, catalogSnapshot, workflowSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(workflowDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (!cycle) throw new HttpsError('not-found', 'מחזור השיבוץ לא נמצא')
  const courses = ((catalogSnapshot.data()?.courses ?? []) as Course[]).filter((course) => course.instructorIds.includes(actor.uid))
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  const publishedAssignments = workflow?.assignmentRun?.publishedAt ? workflow.assignmentRun.assignments : []
  return {
    cycle: { schoolYear: cycle.schoolYear, termLabel: cycle.termLabel, status: cycle.status },
    courses: courses.map((course) => ({ id: course.id, label: course.label, description: course.description, subjectArea: course.subjectArea, students: publishedAssignments.filter((assignment) => assignment.courseId === course.id).map((assignment) => assignment.studentLabel ?? 'תלמיד') })),
  }
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
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['placement_coordinator', 'appeal_reviewer'], capabilities: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.capacity.override.approve', 'nativ.audit.view'] },
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
  {
    label: 'מנחה קורס', email: 'instructor@nativ.demo', password: 'NativDemo!2026', uid: 'teacher-course-theater',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['course_instructor'], capabilities: [] },
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
      try {
        user = await auth.createUser({ email: account.email, password: account.password, displayName: account.label, ...('uid' in account ? { uid: account.uid } : {}) })
      } catch (createError: unknown) {
        if (typeof createError !== 'object' || createError === null || !('code' in createError) || !['auth/email-already-exists', 'auth/uid-already-exists'].includes(String(createError.code))) throw createError
        user = await auth.getUserByEmail(account.email)
      }
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
